const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, getUrlInfo } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const QRCode = require('qrcode')
const axios = require('axios')
const fs = require('fs')
const ogs = require('open-graph-scraper')
const crypto = require('crypto')

// Caché en memoria para resultados de Gestor: evita llamadas repetidas por cada mensaje
// key: telefono (digits only), value: { data: userData|null, expiresAt: timestamp }
const USER_LOOKUP_CACHE = new Map()
const CACHE_TTL_MS = parseInt(process.env.CHAT_LOOKUP_CACHE_TTL_MS || '300000', 10) // 5min por defecto
const CACHE_NEGATIVE_TTL_MS = parseInt(process.env.CHAT_LOOKUP_NEGATIVE_TTL_MS || '30000', 10) // 30s para fallos
const GESTOR_MAX_RETRIES = parseInt(process.env.CHAT_GESTOR_MAX_RETRIES || '3', 10)
const SENDER_MAX_RETRIES = parseInt(process.env.CHAT_SENDER_MAX_RETRIES || '2', 10)

// Almacenar múltiples sesiones
const sessions = new Map()

// Track para evitar logs duplicados
const sessionLogState = new Map()

// Configuración Batch (colas para evitar sobrecarga)
const WEBHOOK_CONFIG = {
    batchSize: 20,           // Mensajes por batch
    batchInterval: 3000,     // ms entre batches
    maxRetries: 3,           // Reintentos si falla
    timeout: 8000,           // Timeout por request
    rateLimitDelay: 50       // ms entre requests individuales
}

// CONFIGURACIÓN ROBUSTA PARA PRODUCCIÓN
const ROBUST_CONFIG = {
    // Aumentar reintentos
    MAX_RECONNECT_ATTEMPTS: 10,        // Más reintentos
    SESSION_TIMEOUT_HOURS: 24,         // 24 horas antes de limpiar
    CLEANUP_INTERVAL_HOURS: 6,         // Limpiar cada 6 horas (no 15 min)
    MAX_AUTO_RECONNECTS: 10,           // Más sesiones automáticas
    RECONNECT_DELAY_BASE: 5000,        // Delay base entre reintentos
    PERSISTENT_SESSION_DAYS: 7         // Mantener sesiones 7 días
}

const webhookBatch = []
const failedWebhooks = []

// Configuración de la API SQL: puede venir por env SQL_API_URL.
// Cuando el código corre dentro de Docker, usar host.docker.internal permite alcanzar servicios en el host Windows.
const API_CONFIG = {
    usuario: 'gestioninmo_86',
    password: 'CAzV4lL3QaDC6kWi',
    url: process.env.SQL_API_URL || 'http://host.docker.internal:8081/api/sql.php'
}

// Crear directorio para multimedia
if (!fs.existsSync('./multimedia')) {
    fs.mkdirSync('./multimedia', { recursive: true })
}

const app = express()

// Servir archivos estáticos (CSS, JS, imágenes) desde /public en la ruta /static
app.use('/static', express.static(require('path').join(__dirname, 'public')))

// Procesar batch de webhooks
async function processBatchWebhooks() {
    if (webhookBatch.length === 0) return
    
    const batch = webhookBatch.splice(0, WEBHOOK_CONFIG.batchSize)
    
    for (let attempt = 1; attempt <= WEBHOOK_CONFIG.maxRetries; attempt++) {
        const success = await sendWebhookBatch(batch)
        
        if (success) {
            console.log(`📦 Batch procesado exitosamente: ${batch.length} mensajes`)
            break
        } else {
            console.error(`❌ Batch falló (intento ${attempt}/${WEBHOOK_CONFIG.maxRetries})`)
            
            if (attempt === WEBHOOK_CONFIG.maxRetries) {
                failedWebhooks.push(...batch)
                console.error(`💀 Batch perdido: ${batch.length} mensajes guardados en fallidos`)
            } else {
                // Esperar antes del siguiente intento
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
            }
        }
    }
}

// Función para generar hash de autenticación
function generateAuthHash(date) {
    const text = `hipotea_whatsapp_${date}`
    const hash = crypto.createHash('sha256').update(text).digest('hex')
    console.log('hash', hash)
    return hash
}

// Función para validar hash
function validateAuthHash(hash, date) {
    const expectedHash = generateAuthHash(date)
    return hash === expectedHash
}

// Middleware de autenticación
function authMiddleware(req, res, next) {
    // Permitir desactivar autenticación en desarrollo/entornos locales
    if (process.env.DISABLE_AUTH === 'true') {
        return next()
    }

    const { hash, date } = req.query

    if (!hash || !date) {
        return res.status(403).send('Acceso no permitido - Faltan parámetros de autenticación')
    }

    // Validar que la fecha sea de hoy
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    if (date !== today) {
        return res.status(403).send('Acceso no permitido - Fecha inválida')
    }

    if (!validateAuthHash(hash, date)) {
        return res.status(403).send('Acceso no permitido - Hash inválido')
    }

    next()
}

// Endpoint de salud para healthchecks
app.get('/health', (req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() })
})

// Página sencilla para generar token de autenticación (solo local o con DISABLE_AUTH)
app.get('/auth', (req, res) => {
    const remote = req.ip || req.connection?.remoteAddress || ''
    const hostHeader = (req.headers && (req.headers.host || req.headers['x-forwarded-host'])) || ''
    const xff = (req.headers && req.headers['x-forwarded-for']) || ''
    const isLocal = remote === '::1' || remote === '127.0.0.1' || remote === '::ffff:127.0.0.1' || hostHeader.includes('localhost') || xff.includes('127.0.0.1')

    if (process.env.DISABLE_AUTH !== 'true' && !isLocal) {
        return res.status(403).send('Acceso no permitido')
    }

    res.send(`
        <!doctype html>
        <html>
        <head><meta charset="utf-8"><title>Generar token</title></head>
        <body style="font-family: Arial; padding: 20px;">
            <h2>Generar token de acceso (válido solo hoy)</h2>
            <p>Pulsa el botón para generar el hash y la URL de acceso para hoy.</p>
            <button id="btn">Generar token para hoy</button>
            <pre id="out" style="background:#f5f5f5;padding:10px;margin-top:10px;border-radius:6px;"></pre>
            <script>
                document.getElementById('btn').addEventListener('click', async () => {
                    const r = await fetch('/auth/token')
                    const j = await r.json()
                    document.getElementById('out').textContent = 'HASH: ' + j.hash + '\nDATE: ' + j.date + '\nURL: http://localhost:3000/?hash=' + j.hash + '&date=' + j.date
                })
            </script>
        </body>
        </html>
    `)
})

// Endpoint que devuelve el token (hash) para hoy en JSON
app.get('/auth/token', (req, res) => {
    const remote = req.ip || req.connection?.remoteAddress || ''
    const hostHeader = (req.headers && (req.headers.host || req.headers['x-forwarded-host'])) || ''
    const xff = (req.headers && req.headers['x-forwarded-for']) || ''
    const isLocal = remote === '::1' || remote === '127.0.0.1' || remote === '::ffff:127.0.0.1' || hostHeader.includes('localhost') || xff.includes('127.0.0.1')

    if (process.env.DISABLE_AUTH !== 'true' && !isLocal) {
        return res.status(403).json({ error: 'Acceso no permitido' })
    }

    const date = new Date().toISOString().split('T')[0]
    const hash = generateAuthHash(date)
    res.json({ hash, date })
})

// Función auxiliar para obtener foto de perfil
async function getProfilePicture(sock, jid) {
    try {
        const profilePicUrl = await sock.profilePictureUrl(jid, 'image')
        return profilePicUrl
    } catch (error) {
        // Si no hay foto de perfil o hay error, devolver null
        console.log(`⚠️ No se pudo obtener foto de perfil para ${jid}: ${error.message}`)
        return null
    }
}

// Función auxiliar para obtener información de grupo
async function getGroupInfo(sock, groupJid) {
    try {
        const groupMetadata = await sock.groupMetadata(groupJid)
        return {
            groupName: groupMetadata.subject,
            groupDescription: groupMetadata.desc || null,
            groupParticipants: groupMetadata.participants?.length || 0,
            isGroup: true
        }
    } catch (error) {
        console.log(`⚠️ No se pudo obtener info de grupo para ${groupJid}: ${error.message}`)
        return null
    }
}

// Función auxiliar para obtener información del contacto remitente
async function getContactInfo(sock, jid) {
    try {
        const contactInfo = {}
        
        // Obtener nombre del contacto (pushName o nombre guardado)
        try {
            const contact = await sock.onWhatsApp(jid)
            if (contact && contact[0]) {
                contactInfo.exists = contact[0].exists
            }
        } catch (err) {
            console.log(`⚠️ Error verificando existencia de ${jid}`)
        }
        
        // Obtener estado/about del contacto
        try {
            const status = await sock.fetchStatus(jid)
            if (status && status.status) {
                contactInfo.estado = status.status
                contactInfo.estado_fecha = status.setAt ? new Date(status.setAt * 1000).toISOString() : null
            }
        } catch (err) {
            console.log(`⚠️ No se pudo obtener estado de ${jid}`)
        }
        
        // Obtener foto de perfil
        try {
            const profilePic = await sock.profilePictureUrl(jid, 'image')
            if (profilePic) {
                contactInfo.foto_perfil = profilePic
            }
        } catch (err) {
            console.log(`⚠️ No se pudo obtener foto de perfil de ${jid}`)
        }
        
        return Object.keys(contactInfo).length > 0 ? contactInfo : null
    } catch (error) {
        console.log(`⚠️ Error obteniendo info de contacto ${jid}: ${error.message}`)
        return null
    }
}

// Agregar mensaje al batch
async function addMessageToBatch(messageData) {
    const finalMessageData = {
        telefono_origen: messageData.telefono_origen,
        telefono_destino: messageData.telefono_destino,
        mensaje: messageData.mensaje,
        direccion: messageData.direccion,
        tipo_mensaje: messageData.tipo_mensaje || 'text',
        timestamp: new Date().toISOString(),
        conversacion_id: [messageData.telefono_origen, messageData.telefono_destino].sort().join('_')
    }
    
    // Añadir información de multimedia si existe
    if (messageData.multimedia) {
        finalMessageData.multimedia = messageData.multimedia
    }
    
    // Añadir foto de perfil si existe
    if (messageData.foto_perfil) {
        finalMessageData.foto_perfil = messageData.foto_perfil
    }
    
    // Añadir información de grupo si existe
    if (messageData.grupo_info) {
        finalMessageData.grupo_info = messageData.grupo_info
    }
    
    // ✅ Añadir información del usuario vinculado (dueño del número)
    if (messageData.usuario_vinculado) {
        finalMessageData.usuario_vinculado = messageData.usuario_vinculado
    }
    
    // ✅ Añadir información del contacto remitente (quien envía el mensaje)
    if (messageData.contacto_remitente) {
        finalMessageData.contacto_remitente = messageData.contacto_remitente
    }
    
    webhookBatch.push(finalMessageData)
    
    console.log(`📝 Mensaje agregado al batch (${webhookBatch.length}/${WEBHOOK_CONFIG.batchSize})`)
    
    // Si el batch está lleno, procesar inmediatamente
    if (webhookBatch.length >= WEBHOOK_CONFIG.batchSize) {
        processBatchWebhooks()
    }
}

// Función para ejecutar consultas SQL
async function executeQuery(query) {
    try {
        const queryBase64 = Buffer.from(query).toString('base64')
        
        const formData = new URLSearchParams()
        formData.append('usuario', API_CONFIG.usuario)
        formData.append('password', API_CONFIG.password)
        formData.append('query', queryBase64)
        formData.append('desarrollo', '0')
        
        const response = await axios.post(API_CONFIG.url, formData, {
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 10000
        })

        if (response.status === 200) {
            return response.data
        } else {
            throw new Error(`Error en la API: ${response.status}`)
        }
    } catch (error) {
        console.error('Error ejecutando query:', error.message)
        throw error
    }

}
// Función para obtener configuración de usuario (simplificada)
async function getUserConfig(sessionId) {
    const session = sessions.get(sessionId)
    if (!session || !session.userData) return null
    
    return session.userData
}

// Función para verificar usuario y registrar en WhatsappSenders
// ⚠️ IMPORTANTE: Esta función se llama SOLO al conectar la sesión (connection.update)
// NO se debe llamar en cada mensaje para evitar sobrecarga de APIs
// El resultado se cachea en sessionData.userData y se reutiliza
async function verificarYRegistrarUsuario(sessionId, deviceNumber) {
    if (!deviceNumber) return null
    // Normalizar número: extraer sólo dígitos
    const digitsOnly = String(deviceNumber).replace(/[^0-9]/g, '')

    // Crear variantes comunes para buscar en la BBDD:
    // - plain: sin prefijo (ej. 612345678)
    // - with34: con prefijo 34 (ej. 34612345678)
    // - with00: con prefijo 00 (ej. 0034612345678)
    const plain = (digitsOnly.length > 9 && digitsOnly.startsWith('0')) ? digitsOnly.replace(/^0+/, '') : digitsOnly
    const with34 = plain.startsWith('34') ? plain : (plain.length === 9 ? '34' + plain : '34' + plain)
    const with00 = '00' + with34
    const normalizedNumber = plain

    // Llamar a la API externa en lugar de ejecutar la query SQL local.
    // La API: configurable por env CHAT_GESTOR_API_URL
    const gestorApiUrl = process.env.CHAT_GESTOR_API_URL || 'https://crabbedly-unpersonalized-angelique.ngrok-free.dev/API/Chat/Gestor'

    // Revisar caché primero
    const cacheKey = digitsOnly
    const now = Date.now()
    const cached = USER_LOOKUP_CACHE.get(cacheKey)
    if (cached && cached.expiresAt > now) {
        // console.log(`🗄️ Cache hit para ${cacheKey}`)
        return cached.data
    }

    // Si estamos en modo desarrollo y se permite saltar la verificación, devolver usuario virtual
    if (process.env.SKIP_USER_VERIFICATION === 'true') {
        const virtualUser = {
            IdGestor: 0,
            IdAgencia: 0,
            Nombre: 'DEV',
            Apellidos: 'USER',
            SyncConversaciones: 1,
            AutomatizacionesWhatsapp: 0,
            CrucesAutomaticos: 0,
            CrucesAutomaticosRGPDExterna: 0,
            PilotoAutomatico: 0,
            RecordatoriosVisitas: 0
        }
        USER_LOOKUP_CACHE.set(cacheKey, { data: virtualUser, expiresAt: now + CACHE_TTL_MS })
        console.log(`🛠️ SKIP_USER_VERIFICATION activo - usando usuario virtual desde verificarYRegistrarUsuario para ${cacheKey}`)
        return virtualUser
    }

    try {
        console.log(`🔎 verificarYRegistrarUsuario - llamando a Gestor API: ${gestorApiUrl} - telefono=${deviceNumber} (digitsOnly=${digitsOnly})`)

        const headers = {}
        if (process.env.CHAT_API_KEY) {
            headers['x-api-key'] = process.env.CHAT_API_KEY
        }

        let lastErr = null
        let resp = null
        for (let attempt = 1; attempt <= GESTOR_MAX_RETRIES; attempt++) {
            try {
                resp = await axios.get(gestorApiUrl, {
                    params: { phone: deviceNumber },
                    headers,
                    timeout: parseInt(process.env.CHAT_GESTOR_TIMEOUT_MS || '10000', 10)
                })
                break
            } catch (err) {
                lastErr = err
                const wait = 200 * attempt
                console.warn(`⚠️ Intento ${attempt}/${GESTOR_MAX_RETRIES} falló al llamar Gestor: ${err.code || err.message}; reintentando en ${wait}ms`)
                await new Promise(r => setTimeout(r, wait))
            }
        }

        if (!resp) {
            console.error('❌ Fallaron todos los intentos a Gestor API:', lastErr && (lastErr.message || lastErr.code))
            // Cache negativo corto para evitar spams continuos
            USER_LOOKUP_CACHE.set(cacheKey, { data: null, expiresAt: now + CACHE_NEGATIVE_TTL_MS })
            return null
        }

        // Si la API devuelve 204 (sin contenido), tratar como no encontrado
        let userData = null
        if (resp.status === 200 && resp.data) {
            console.log(`🔍 Debug Gestor API response:`, JSON.stringify(resp.data, null, 2))
            const d = resp.data
            const normalizedUser = {
                Nombre: d.Nombre || d.nombre || '' ,
                Apellidos: d.Apellidos || d.apellidos || '' ,
                IdGestor: d.IdGestor || d.id_usuario || d.id || null,
                IdAgencia: d.IdAgencia || d.id_inmobiliaria || d.id_agencia || null,
                SyncConversaciones: (d.SyncConversaciones ?? d.sync_conversaciones ?? d.sync_conversation ?? 0),
                AutomatizacionesWhatsapp: (d.AutomatizacionesWhatsapp ?? d.automatizaciones_whatsapp ?? 0),
                CrucesAutomaticos: (d.CrucesAutomaticos ?? d.cruces_automaticos ?? 0),
                CrucesAutomaticosRGPDExterna: (d.CrucesAutomaticosRGPDExterna ?? d.cruces_automaticos_rgpd_externa ?? 0),
                PilotoAutomatico: (d.PilotoAutomatico ?? d.piloto_automatico ?? 0),
                RecordatoriosVisitas: (d.RecordatoriosVisitas ?? d.recordatorios_visitas ?? 0)
            }
            userData = normalizedUser
        } else if (resp.status === 204) {
            userData = null
        } else {
            console.log(`⚠️ Gestor API devolvió status=${resp.status}`)
            userData = null
        }

        // No cachear todavía: solo cacheamos positivo si el registro en Sender o el
        // fallback SQL fue exitoso. Si no, devolveremos null para impedir vinculación.
        if (userData) {
            console.log(`👤 Usuario ENCONTRADO: ${userData.Nombre || userData.nombre || ''} ${userData.Apellidos || userData.apellidos || ''} (ID: ${userData.IdGestor || userData.id_usuario || 'unknown'})`)
            // Usuario válido, registrar/actualizar en WhatsappSenders
            const currentVersion = 5 // Tu versión actual

            // En lugar de ejecutar INSERT SQL local, llamar a la API Sender
            const senderApiUrl = process.env.CHAT_SENDER_API_URL || 'https://crabbedly-unpersonalized-angelique.ngrok-free.dev/API/Chat/Sender'

            const payload = {
                IdAgencia: userData.IdAgencia || 0,
                IdGestor: userData.IdGestor || 0,
                Telefono: deviceNumber,
                Version: currentVersion,
                SyncConversaciones: userData.SyncConversaciones || 0,
                AutomatizacionesWhatsapp: userData.AutomatizacionesWhatsapp || 0,
                CrucesAutomaticos: userData.CrucesAutomaticos || 0,
                CrucesAutomaticosRGPDExterna: userData.CrucesAutomaticosRGPDExterna || 0,
                PilotoAutomatico: userData.PilotoAutomatico || 0,
                RecordatoriosVisitas: userData.RecordatoriosVisitas || 0
            }

            let registrationSuccess = false
            try {
                const headers = { 'Content-Type': 'application/json' }
                if (process.env.CHAT_API_KEY) headers['x-api-key'] = process.env.CHAT_API_KEY

                console.log(`🔁 Registrando/actualizando Sender vía API: ${senderApiUrl} - payload:`, payload)

                let lastSenderErr = null
                for (let attempt = 1; attempt <= SENDER_MAX_RETRIES; attempt++) {
                    try {
                        const resp = await axios.post(senderApiUrl, payload, { headers, timeout: parseInt(process.env.CHAT_SENDER_TIMEOUT_MS || '8000', 10) })
                        if (resp && resp.status === 200) {
                            console.log(`✅ Sender registrado/actualizado (API): telefono_normalizado=${resp.data.telefono_normalizado || 'unknown'}, affected_rows=${resp.data.affected_rows ?? 'n/a'}`)
                            registrationSuccess = true
                            break
                        } else {
                            console.warn(`⚠️ Sender API devolvió status=${resp?.status}`)
                        }
                    } catch (err) {
                        lastSenderErr = err
                        const wait = 150 * attempt
                        console.warn(`⚠️ Intento ${attempt}/${SENDER_MAX_RETRIES} fallo Sender API: ${err.code || err.message}; reintentando en ${wait}ms`)
                        await new Promise(r => setTimeout(r, wait))
                    }
                }
                // Si no se registró via API, intentar fallback SQL
                if (!registrationSuccess) {
                    console.warn('⚠️ Sender API no registró al usuario; intentando fallback SQL')
                    try {
                        const updateQuery = `INSERT INTO WhatsappSenders (IdAgencia, IdUsuario, Telefono, FechaUltimaInteraccion, Version, SyncConversaciones, AutomatizacionesWhatsapp, CrucesAutomaticos, CrucesAutomaticosRGPDExterna, PilotoAutomatico, RecordatoriosVisitas) VALUES (${userData.IdAgencia || 0}, ${userData.IdGestor || 0}, '${deviceNumber}', NOW(), ${currentVersion}, COALESCE(${userData.SyncConversaciones || 0}, 0), COALESCE(${userData.AutomatizacionesWhatsapp || 0}, 0), COALESCE(${userData.CrucesAutomaticos || 0}, 0), COALESCE(${userData.CrucesAutomaticosRGPDExterna || 0}, 0), COALESCE(${userData.PilotoAutomatico || 0}, 0), COALESCE(${userData.RecordatoriosVisitas || 0}, 0)) ON DUPLICATE KEY UPDATE FechaUltimaInteraccion = NOW(), Version = ${currentVersion}, Telefono = '${normalizedNumber}', ImagenQR = NULL, PathEjecutable = NULL`
                        await executeQuery(updateQuery)
                        registrationSuccess = true
                        console.log(`✅ Fallback: Usuario registrado localmente tras fallo de API: ${userData.Nombre || userData.nombre || ''} ${userData.Apellidos || userData.apellidos || ''} (${userData.IdGestor})`)
                    } catch (fallbackErr) {
                        console.error(`❌ Fallback también falló: ${fallbackErr && (fallbackErr.message || fallbackErr.code)}`)
                        registrationSuccess = false
                    }
                }

                // Si el registro fue exitoso, cachear resultado positivo y devolver userData
                if (registrationSuccess) {
                    USER_LOOKUP_CACHE.set(cacheKey, { data: userData, expiresAt: now + CACHE_TTL_MS })
                    return userData
                }

                // Si todo falló, cachear negativo y devolver null para impedir vinculación
                USER_LOOKUP_CACHE.set(cacheKey, { data: null, expiresAt: now + CACHE_NEGATIVE_TTL_MS })
                console.error('❌ NO se pudo registrar el sender mediante API ni fallback; cancelando vinculación')
                return null
            } catch (err) {
                console.error(`❌ Error en proceso de registro: ${err && (err.message || err.code)}`)
                // En caso de error inesperado, marcar negativo y no permitir vinculación
                USER_LOOKUP_CACHE.set(cacheKey, { data: null, expiresAt: now + CACHE_NEGATIVE_TTL_MS })
                return null
            }

        } else {
            // Si no se encontró usuario en Gestor, NO crear usuario virtual cuando estamos
            // en modo producción (SKIP_USER_VERIFICATION !== 'true'). Devuelve null para
            // impedir la vinculación.
            console.log(`❌ NO se encontró usuario para: deviceNumber=${deviceNumber}, normalizedNumber=${normalizedNumber}`)
            console.log(`🔍 Gestor API llamada: ${gestorApiUrl}?phone=${deviceNumber}`)
            // Cache negativo corto para evitar intentos repetidos
            USER_LOOKUP_CACHE.set(cacheKey, { data: null, expiresAt: now + CACHE_NEGATIVE_TTL_MS })
            return null
        }
    } catch (error) {
        console.error('Error verificando usuario:', error)
        return null
    }
}

// Función auxiliar para obtener sessionPath de manera consistente
function getSessionPath(sessionId, session = null) {
    const sessionData = session || sessions.get(sessionId);
    return sessionData?.sessionPath || `./sessions/${sessionId}`;
}

// Función para enviar webhook al usuario final
async function sendWebhookBatch(batch) {
    try {
        const webhookUrl = process.env.WEBHOOK_URL || 'http://host.docker.internal:8081/api/whatsapp_node_webhook.php'
        console.log(`🔄 Enviando batch de ${batch.length} mensajes al webhook: ${webhookUrl}`)
        const response = await axios.post(webhookUrl, {
            mensajes: batch,
            total: batch.length,
            timestamp: new Date().toISOString()
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: WEBHOOK_CONFIG.timeout || 8000
        })

        // Log básico de resultado
        if (response && response.status >= 200 && response.status < 300) {
            console.log('✅ Batch webhook enviado correctamente')
            return true
        }
        console.error('❌ Batch webhook devolvió status:', response.status)
        return false
    } catch (error) {
        console.error('❌ Error enviando batch webhook:', error.message)
        return false
    }
}

// Función para enviar update al dashboard (puerto 3001)
async function sendDashboardUpdate(sessionId, type, data) {
    try {
        const endpoint = type === 'connection' ? '/webhook/connection' : '/webhook/message'
        const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3001'
        await axios.post(`${dashboardUrl}${endpoint}`, {
            deviceId: sessionId,
            ...data
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        })
        //console.log(`📊 Dashboard actualizado: ${type}`)
    } catch (error) {
        const shortId = sessionId.split('_').pop()
        console.error(`[${shortId}] ❌ Error actualizando dashboard: ${error.message}`)
    }
}

// Generar ID único para cada sesión
function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15)
}

// Función para conectar WhatsApp (una sesión específica)
async function connectWhatsApp(sessionId) {
    try {

        logStateChange(sessionId, 'initializing')
        
        // Actualizar estado en memoria
        sessions.set(sessionId, {
            status: 'connecting',
            qr: null,
            deviceNumber: null,
            error: null,
            lastUpdate: new Date(),
            sessionPath: null
        })

        // ✅ Crear directorio SOLO cuando tengamos QR (conexión válida iniciada)
        sessionPath = null;
        state = null;
        saveCreds = null;

        sessionPath = `./sessions/${sessionId}`
        
        // Función para crear carpeta solo cuando sea necesario
        const ensureSessionDir = () => {
            if (!fs.existsSync(sessionPath)) {
                fs.mkdirSync(sessionPath, { recursive: true });
                console.log(`📁 [${sessionId.split('_').pop()}] Carpeta creada: ${sessionPath}`);
                
                // Marcar que se creó la carpeta
                const currentSession = sessions.get(sessionId);
                sessions.set(sessionId, {
                    ...currentSession,
                    sessionPath: sessionPath
                });
            }
        };

        try {
            // Solo crear carpeta cuando useMultiFileAuthState la necesite
            ensureSessionDir();
            
            const authResult = await useMultiFileAuthState(sessionPath);
            state = authResult.state;
            saveCreds = authResult.saveCreds;
            
        } catch (authError) {
            console.error(`❌ [${sessionId.split('_').pop()}] Error configurando autenticación: ${authError.message}`);
            // ✅ Si falla la autenticación, borrar carpeta inmediatamente
            if (sessionPath && fs.existsSync(sessionPath)) {
                try {
                    fs.rmSync(sessionPath, { recursive: true });
                    console.log(`🗑️ [${sessionId.split('_').pop()}] Carpeta borrada por error de auth`);
                } catch (e) {}
            }
            throw authError;
        }
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: require('pino')({ level: 'error' }),
            browser: ['WhatsApp Manager', 'Chrome', '91.0.4472.124'],
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,  // Habilitar linkPreviews de alta calidad
            getMessage: async () => {
                return { conversation: 'hello' }  // Requerido para linkPreviews
            }
        })

        sock.ev.on('creds.update', saveCreds)

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update
            
            if (qr) {
                
                sessions.set(sessionId, {
                    ...sessions.get(sessionId),
                    status: 'waiting_scan',
                    qr: qr,
                    lastUpdate: new Date()
                })
                
                logStateChange(sessionId, 'waiting_scan', { qr: qr })
                
                // Actualizar dashboard
                await sendDashboardUpdate(sessionId, 'connection', {
                    status: 'waiting_scan',
                    phoneNumber: null
                })
            }
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut
                const errorMsg = lastDisconnect?.error?.message || 'Error desconocido'

                // Control de reintentos
                const currentSession = sessions.get(sessionId)
                const reconnectAttempts = (currentSession?.reconnectAttempts || 0) + 1
                
                sessions.set(sessionId, {
                    ...sessions.get(sessionId),
                    status: 'disconnected',
                    error: errorMsg,
                    socket: null,
                    reconnectAttempts: reconnectAttempts,
                    lastUpdate: new Date()
                })
                
                logStateChange(sessionId, 'disconnected', { error: errorMsg })
                
                // Actualizar dashboard
                await sendDashboardUpdate(sessionId, 'connection', {
                    status: 'disconnected',
                    error: errorMsg
                })
                
                if (shouldReconnect && reconnectAttempts <= ROBUST_CONFIG.MAX_RECONNECT_ATTEMPTS) {
                    const shortId = sessionId.split('_').pop()
                    const delay = Math.min(ROBUST_CONFIG.RECONNECT_DELAY_BASE * reconnectAttempts, 60000) // Max 60s
                    console.log(`🔄 [${shortId}] Reintento ${reconnectAttempts}/${ROBUST_CONFIG.MAX_RECONNECT_ATTEMPTS} en ${delay/1000}s`)
                    setTimeout(() => connectWhatsApp(sessionId), delay)
                } else if (reconnectAttempts > ROBUST_CONFIG.MAX_RECONNECT_ATTEMPTS) {
                    const shortId = sessionId.split('_').pop()
                    console.log(`💀 [${shortId}] Abandonando tras ${ROBUST_CONFIG.MAX_RECONNECT_ATTEMPTS} fallos - MARCANDO PARA REVISIÓN`)
                    
                    // Limpiar archivos
                    const sessionPath = `./sessions/${sessionId}`
                    if (fs.existsSync(sessionPath)) {
                        try {
                            fs.rmSync(sessionPath, { recursive: true })
                        } catch (e) {}
                    }
                    sessions.delete(sessionId)
                }
            } else if (connection === 'open') {
                let deviceNumber = null
                try {
                    if (sock.user && sock.user.id) {
                        deviceNumber = sock.user.id.split(':')[0].replace(/[^0-9]/g, '')
                    }
                } catch (e) {
                    console.log(`⚠️  ${sessionId} - Error obteniendo número`)
                }
                
                // Verificar si el usuario está autorizado
                let userData = null

                if (process.env.SKIP_USER_VERIFICATION === 'true') {
                    // Entorno de desarrollo: permitir conexión aunque no esté en la API
                    userData = {
                        IdGestor: 0,
                        IdAgencia: 0,
                        Nombre: 'DEV',
                        Apellidos: 'USER',
                        SyncConversaciones: 1
                    }
                    console.log(`🛠️ [${sessionId.split('_').pop()}] SKIP_USER_VERIFICATION activo - permitiendo conexión de prueba (+${deviceNumber})`)
                } else {
                    userData = await verificarYRegistrarUsuario(sessionId, deviceNumber)
                }

                if (!userData) {
                    sessions.set(sessionId, {
                        ...sessions.get(sessionId),
                        status: 'unauthorized',
                        error: 'Usuario no autorizado en el sistema',
                        deviceNumber: deviceNumber,
                        socket: null,
                        lastUpdate: new Date()
                    })

                    logStateChange(sessionId, 'unauthorized', { 
                        deviceNumber: deviceNumber,
                        error: 'Usuario no autorizado'
                    })
                    
                    // Cerrar la conexión
                    try {
                        sock.end()
                    } catch (e) {}
                    
                    await sendDashboardUpdate(sessionId, 'connection', {
                        status: 'unauthorized',
                        phoneNumber: deviceNumber,
                        error: 'Usuario no autorizado'
                    })
                    
                    return
                }

                sessions.set(sessionId, {
                    ...sessions.get(sessionId),
                    status: 'connected',
                    qr: null,
                    deviceNumber: deviceNumber,
                    userData: userData,
                    error: null,
                    socket: sock,
                    lastUpdate: new Date()
                })
                
                logStateChange(sessionId, 'connected', { 
                    deviceNumber: deviceNumber,
                    userName: `${userData.Nombre} ${userData.Apellidos}`,
                    userAgent: userData.IdAgencia
                })

                // Verificar y manejar teléfonos duplicados
                handleDuplicatePhone(sessionId, deviceNumber)
                
                // Actualizar dashboard
                await sendDashboardUpdate(sessionId, 'connection', {
                    status: 'connected',
                    phoneNumber: deviceNumber,
                    userName: `${userData.Nombre} ${userData.Apellidos}`,
                    userAgent: userData.IdAgencia
                })
            }
        })
        // Manejar mensajes
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const sessionData = sessions.get(sessionId)
                if (!sessionData || sessionData.status !== 'connected') return
                
                // ✅ OPTIMIZACIÓN: Usar userData ya verificado en la conexión
                // No hacer llamadas API en cada mensaje
                const userData = sessionData.userData
                const shouldSyncSentMessages = userData && userData.SyncConversaciones == 1
                
                const messages = m.messages || []
                
                for (const msg of messages) {
                    if (msg.message) {  // Todos los mensajes
                        let fromPhone = ''
                        let toPhone = ''
                        const isFromMe = msg.key.fromMe
                        const remoteJid = msg.key.remoteJid
                        const isGroup = remoteJid && remoteJid.endsWith('@g.us')

                        // ✅ Verificar si debemos procesar mensajes enviados según configuración del usuario
                        if (isFromMe && !shouldSyncSentMessages) {
                            // Usuario tiene SyncConversaciones=0, omitir mensajes enviados
                            continue
                        }
                        
                        // Procesar mensaje (recibido O enviado si SyncConversaciones=1)
                        if (true) {
                            if (isFromMe) {
                                // Mensaje ENVIADO por ti
                                fromPhone = sessionData.deviceNumber || 'UNKNOWN'
                                if (isGroup) {
                                    // En grupos, el 'to' es el grupo completo
                                    toPhone = remoteJid.split('@')[0]
                                } else {
                                    // Chat individual
                                    toPhone = remoteJid || ''
                                    if (toPhone.includes('@')) {
                                        toPhone = toPhone.split('@')[0]
                                    }
                                }
                                toPhone = toPhone.replace(/[^0-9]/g, '')
                                
                            } else {
                                // Mensaje RECIBIDO
                                if (isGroup) {
                                    // En grupos, el 'from' es el participante individual
                                    fromPhone = msg.key.participant || remoteJid
                                    if (fromPhone.includes('@')) {
                                        fromPhone = fromPhone.split('@')[0]
                                    }
                                    // El 'to' sigue siendo tu número
                                    toPhone = sessionData.deviceNumber || 'UNKNOWN'
                                } else {
                                    // Chat individual normal
                                    fromPhone = remoteJid || ''
                                    if (fromPhone.includes('@')) {
                                        fromPhone = fromPhone.split('@')[0]
                                    }
                                    toPhone = sessionData.deviceNumber || 'UNKNOWN'
                                }
                                fromPhone = fromPhone.replace(/[^0-9]/g, '')
                            }

                            // Filtrar mensajes problemáticos
                            if (!fromPhone || fromPhone.length < 9) {
                                console.log(`⚠️ Mensaje ignorado - teléfono origen inválido: "${fromPhone}"`)
                                continue // Saltar este mensaje
                            }

                            // También filtrar mensajes de estados
                            if (msg.key.remoteJid?.includes('status@broadcast')) {
                                console.log(`📱 Mensaje de estado ignorado`)
                                continue
                            }
                            
                            let messageText = ''
                            let messageType = 'text'
                            let mediaInfo = null

                            if (msg.message.conversation) {
                                messageText = msg.message.conversation
                            } else if (msg.message.extendedTextMessage) {
                                messageText = msg.message.extendedTextMessage.text
                            } else if (msg.message.imageMessage) {
                                const imageMsg = msg.message.imageMessage
                                messageText = imageMsg.caption || 'Imagen enviada'
                                messageType = 'image'
                                
                                // Información multimedia para enviar al webhook
                                mediaInfo = {
                                    url: imageMsg.url || null,
                                    directPath: imageMsg.directPath || null,
                                    mediaKey: imageMsg.mediaKey || null,
                                    fileEncSha256: imageMsg.fileEncSha256 || null,
                                    fileSha256: imageMsg.fileSha256 || null,
                                    fileLength: imageMsg.fileLength || 0,
                                    mimetype: imageMsg.mimetype || 'image/jpeg',
                                    width: imageMsg.width || 0,
                                    height: imageMsg.height || 0
                                }
                            } else if (msg.message.videoMessage) {
                                const videoMsg = msg.message.videoMessage
                                messageText = videoMsg.caption || 'Video enviado'
                                messageType = 'video'
                                
                                mediaInfo = {
                                    url: videoMsg.url || null,
                                    directPath: videoMsg.directPath || null,
                                    mediaKey: videoMsg.mediaKey || null,
                                    fileEncSha256: videoMsg.fileEncSha256 || null,
                                    fileSha256: videoMsg.fileSha256 || null,
                                    fileLength: videoMsg.fileLength || 0,
                                    mimetype: videoMsg.mimetype || 'video/mp4',
                                    seconds: videoMsg.seconds || 0
                                }
                            } else if (msg.message.audioMessage) {
                                const audioMsg = msg.message.audioMessage
                                messageText = 'Audio enviado'
                                messageType = 'audio'
                                
                                mediaInfo = {
                                    url: audioMsg.url || null,
                                    directPath: audioMsg.directPath || null,
                                    mediaKey: audioMsg.mediaKey || null,
                                    fileEncSha256: audioMsg.fileEncSha256 || null,
                                    fileSha256: audioMsg.fileSha256 || null,
                                    fileLength: audioMsg.fileLength || 0,
                                    mimetype: audioMsg.mimetype || 'audio/ogg',
                                    seconds: audioMsg.seconds || 0,
                                    ptt: audioMsg.ptt || false // true si es nota de voz
                                }
                            } else if (msg.message.documentMessage) {
                                const docMsg = msg.message.documentMessage
                                const fileName = docMsg.fileName || 'documento'
                                messageText = `Documento: ${fileName}`
                                messageType = 'document'
                                
                                mediaInfo = {
                                    url: docMsg.url || null,
                                    directPath: docMsg.directPath || null,
                                    mediaKey: docMsg.mediaKey || null,
                                    fileEncSha256: docMsg.fileEncSha256 || null,
                                    fileSha256: docMsg.fileSha256 || null,
                                    fileLength: docMsg.fileLength || 0,
                                    mimetype: docMsg.mimetype || 'application/octet-stream',
                                    fileName: fileName,
                                    title: docMsg.title || fileName
                                }
                            } else {
                                messageText = '[Mensaje multimedia]'
                            }
                            
                            const direction = isFromMe ? 'ENVIADO' : 'RECIBIDO'
                            const arrow = isFromMe ? '→' : '←'
                            
                            // ✅ Log simplificado: solo mostrar si es relevante
                            if (!isFromMe || shouldSyncSentMessages) {
                                logMessage(sessionId, direction, fromPhone, toPhone, messageText)
                            }

                            // Crear objeto base del mensaje
                            const messageData = {
                                telefono_origen: fromPhone,
                                telefono_destino: toPhone,
                                mensaje: messageText,
                                direccion: isFromMe ? 'enviado' : 'recibido',
                                tipo_mensaje: messageType,
                                multimedia: mediaInfo,
                                // ✅ Agregar información del usuario vinculado (dueño del número)
                                usuario_vinculado: {
                                    telefono: sessionData.deviceNumber,
                                    nombre: userData ? userData.Nombre : null,
                                    apellidos: userData ? userData.Apellidos : null,
                                    id_gestor: userData ? userData.IdGestor : null,
                                    id_agencia: userData ? userData.IdAgencia : null,
                                    sync_conversaciones: userData ? userData.SyncConversaciones : 0
                                }
                            }
                            
                            // ✅ Agregar información del contacto remitente (el que envía el mensaje)
                            if (!isFromMe) {
                                const remitenteInfo = {
                                    telefono: fromPhone,
                                    nombre: msg.pushName || null  // Nombre que usa en WhatsApp
                                }
                                
                                // Agregar JID del remitente para consultas futuras
                                const remitenteJid = isGroup ? msg.key.participant : msg.key.remoteJid
                                if (remitenteJid) {
                                    remitenteInfo.jid = remitenteJid
                                }
                                
                                messageData.contacto_remitente = remitenteInfo
                            }

                            // OBTENER INFORMACIÓN ADICIONAL: Perfil y grupos
                            try {
                                if (isGroup) {
                                    // Es un grupo - obtener información del grupo
                                    console.log(`👥 Procesando mensaje de grupo: ${remoteJid}`)
                                    
                                    const groupInfo = await getGroupInfo(sock, remoteJid)
                                    if (groupInfo) {
                                        messageData.grupo_info = {
                                            nombre_grupo: groupInfo.groupName,
                                            descripcion_grupo: groupInfo.groupDescription,
                                            participantes_count: groupInfo.groupParticipants,
                                            es_grupo: true
                                        }
                                        console.log(`✅ Info grupo obtenida: ${groupInfo.groupName}`)
                                    } else {
                                        messageData.grupo_info = { es_grupo: true }
                                    }
                                    
                                    // Para grupos, obtener foto del participante individual
                                    if (!isFromMe && msg.key.participant) {
                                        const participantJid = msg.key.participant
                                        const profilePicUrl = await getProfilePicture(sock, participantJid)
                                        if (profilePicUrl) {
                                            messageData.foto_perfil = profilePicUrl
                                            console.log(`📸 Foto perfil participante obtenida`)
                                        }
                                    }
                                    
                                } else {
                                    // Es chat individual - FOTO DE PERFIL DESACTIVADA (causa timeouts)
                                    // const contactJid = isFromMe ? remoteJid : msg.key.remoteJid
                                    // if (contactJid) {
                                    //     const profilePicUrl = await getProfilePicture(sock, contactJid)
                                    //     if (profilePicUrl) {
                                    //         messageData.foto_perfil = profilePicUrl
                                    //         console.log(`📸 Foto perfil individual obtenida`)
                                    //     }
                                    // }
                                    
                                    messageData.grupo_info = { es_grupo: false }
                                }
                            } catch (error) {
                                console.error(`❌ Error obteniendo info adicional: ${error.message}`)
                                // Asegurar que siempre tengamos grupo_info
                                messageData.grupo_info = { es_grupo: isGroup }
                            }
                            
                            // Agregar al batch de webhooks el mensaje
                            addMessageToBatch(messageData)
                            
                            // Actualizar dashboard
                            await sendDashboardUpdate(sessionId, 'message', {
                                from: fromPhone,
                                to: toPhone,
                                message: messageText,
                                messageType: 'text',
                                direction: isFromMe ? 'sent' : 'received'
                            })
                        }
                    }
                }
            } catch (error) {
                console.error(`❌ ${sessionId} - Error procesando mensajes:`, error.message)
                console.error(error.stack)
            }
        })

        return sock
        
    } catch (error) {
        console.error(`❌ ${sessionId} - ERROR FATAL:`, error.message)
        const currentSession = sessions.get(sessionId)
        const attempts = (currentSession?.reconnectAttempts || 0) + 1
        
        sessions.set(sessionId, {
            ...sessions.get(sessionId),
            status: 'error',
            error: error.message,
            reconnectAttempts: attempts,
            lastUpdate: new Date()
        })
        
        // Reintentar si no se agotaron los intentos
        if (attempts <= ROBUST_CONFIG.MAX_RECONNECT_ATTEMPTS) {
            setTimeout(() => connectWhatsApp(sessionId), 10000 + (attempts * 5000))
        }
    }
}

// Página principal - MANTENER SESIÓN
app.get('/', authMiddleware, async (req, res) => {
    let sessionId = req.query.session
    const forceNew = req.query.new === 'true'

    if (forceNew || !sessionId) {
        console.log(`🔍 PÁGINA SOLICITADA - sessionId: ${sessionId}, new: ${forceNew}`)
    }

    if (!sessionId || forceNew || !sessions.has(sessionId)) {
        sessionId = generateSessionId()
        console.log(`🆕 CREANDO NUEVA SESIÓN: ${sessionId}`)

        // Inicializar sesión inmediatamente
        sessions.set(sessionId, {
            status: 'initializing',
            qr: null,
            deviceNumber: null,
            error: null,
            lastUpdate: new Date(),
            reconnectAttempts: 0,
            sessionPath: null 
        })

        // Iniciar conexión
        connectWhatsApp(sessionId)

        // IMPORTANTE: Redirigir para mantener la sesión en la URL
        console.log(`🔄 REDIRIGIENDO a /?session=${sessionId}`)
        const { hash, date } = req.query
        let redirectUrl = `/?session=${sessionId}`
        if (hash && date) {
            redirectUrl += `&hash=${hash}&date=${date}`
        }
        return res.redirect(redirectUrl)
    }

    const session = sessions.get(sessionId)
    if (session?.status !== 'connected') {
        console.log(`📄 RENDERIZANDO - sessionId: ${sessionId}, status: ${session?.status}, hasQR: ${!!session?.qr}`)
    }

    let qrImage = ''
    if (session.qr) {
        try {
            qrImage = await QRCode.toDataURL(session.qr)
            console.log(`🎯 ${sessionId} - QR CONVERTIDO A IMAGEN`)
        } catch (e) {
            console.error(`❌ ${sessionId} - Error generando imagen QR:`, e)
        }
    }

    // Render simple template
    try {
        const tplPath = './templates/session.html'
        let tpl = fs.readFileSync(tplPath, 'utf8')

        // Helpers
    const status = session?.status || 'initializing'

    // REFRESH configurable por ENV: permitir que en desarrollo se use un intervalo muy corto
    // Para evitar abusos, aplicamos límites mínimos y máximos.
    // REFRESH_MS_WAITING_SCAN: intervalo cuando hay QR (por defecto 1000ms)
    // REFRESH_MS_DEFAULT: intervalo para otros estados (por defecto 2000ms)
    const envWaiting = parseInt(process.env.REFRESH_MS_WAITING_SCAN || '', 10)
    const envDefault = parseInt(process.env.REFRESH_MS_DEFAULT || '', 10)

    const MIN_REFRESH_MS = 250      // mínimo 250ms
    const MAX_REFRESH_MS = 60000    // máximo 60s

    const waitingDefault = Number.isFinite(envWaiting) && !isNaN(envWaiting) ? envWaiting : 1000
    const defaultDefault = Number.isFinite(envDefault) && !isNaN(envDefault) ? envDefault : 2000

    const clamp = (v) => Math.max(MIN_REFRESH_MS, Math.min(MAX_REFRESH_MS, Number(v) || 0))

    const refreshMs = status === 'waiting_scan' ? clamp(waitingDefault) : clamp(defaultDefault)

        // Replace simple placeholders
        tpl = tpl.replace(/{{SESSION_ID}}/g, sessionId)
        tpl = tpl.replace(/{{QR_IMAGE}}/g, qrImage || '')
        tpl = tpl.replace(/{{REFRESH_MS}}/g, String(refreshMs))
        tpl = tpl.replace(/{{DEVICE_NUMBER}}/g, session.deviceNumber || '')
        tpl = tpl.replace(/{{ERROR_TEXT}}/g, session.error || '')
        tpl = tpl.replace(/{{STATUS_TEXT}}/g, status)
        tpl = tpl.replace(/{{STATUS_CLASS}}/g, status)
        tpl = tpl.replace(/{{STATUS_BADGE}}/g, (status||'INITIALIZING').toUpperCase())
        tpl = tpl.replace(/{{QR_STATUS}}/g, session.qr ? 'DISPONIBLE' : 'GENERANDO')
        tpl = tpl.replace(/{{LOADING_TEXT}}/g, status === 'connecting' ? 'Conectando a WhatsApp...' : 'Preparando tu sesión...')

        // Conditional blocks
        tpl = tpl.replace(/\{\{#IF_QR\}\}[\s\S]*?\{\{#END_IF_QR\}\}/g, (m) => session.qr ? m.replace(/\{\{#IF_QR\}\}|\{\{#END_IF_QR\}\}/g, '') : '')
        tpl = tpl.replace(/\{\{#IF_CONNECTED\}\}[\s\S]*?\{\{#END_IF_CONNECTED\}\}/g, (m) => status === 'connected' ? m.replace(/\{\{#IF_CONNECTED\}\}|\{\{#END_IF_CONNECTED\}\}/g, '') : '')
        tpl = tpl.replace(/\{\{#IF_UNAUTHORIZED\}\}[\s\S]*?\{\{#END_IF_UNAUTHORIZED\}\}/g, (m) => status === 'unauthorized' ? m.replace(/\{\{#IF_UNAUTHORIZED\}\}|\{\{#END_IF_UNAUTHORIZED\}\}/g, '') : '')
        tpl = tpl.replace(/\{\{#IF_ERROR\}\}[\s\S]*?\{\{#END_IF_ERROR\}\}/g, (m) => status === 'error' ? m.replace(/\{\{#IF_ERROR\}\}|\{\{#END_IF_ERROR\}\}/g, '') : '')
        tpl = tpl.replace(/\{\{#IF_DEFAULT\}\}[\s\S]*?\{\{#END_IF_DEFAULT\}\}/g, (m) => ['connected','unauthorized','error'].includes(status) ? '' : m.replace(/\{\{#IF_DEFAULT\}\}|\{\{#END_IF_DEFAULT\}\}/g, ''))
        tpl = tpl.replace(/\{\{#IF_DEVICE_NUMBER\}\}[\s\S]*?\{\{#END_IF_DEVICE_NUMBER\}\}/g, (m) => session.deviceNumber ? m.replace(/\{\{#IF_DEVICE_NUMBER\}\}|\{\{#END_IF_DEVICE_NUMBER\}\}/g, '') : '')

        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        return res.send(tpl)

    } catch (err) {
        console.error('❌ Error cargando plantilla:', err.message)
        // Caída suave: enviar HTML inline como fallback
        return res.send('<pre>Error cargando plantilla: ' + err.message + '</pre>')
    }
})

// Crear directorio de sesiones
if (!fs.existsSync('./sessions')) {
    fs.mkdirSync('./sessions', { recursive: true })
}

// Función mejorada para verificar si una sesión tiene archivos válidos
function hasValidSessionFiles(sessionPath) {
    try {
        // Verificar que existan los archivos críticos de Baileys
        const requiredFiles = ['creds.json'];
        const optionalFiles = ['app-state-sync-version.json', 'session-info.json'];
        
        let hasRequired = false;
        let hasOptional = false;
        
        if (fs.existsSync(sessionPath)) {
            const files = fs.readdirSync(sessionPath);
            
            // Verificar archivos requeridos
            hasRequired = requiredFiles.some(file => files.includes(file));
            
            // Verificar archivos opcionales (indica sesión más completa)
            hasOptional = optionalFiles.some(file => files.includes(file));
            
            // Si tiene creds.json, es válida
            if (hasRequired) {
                console.log(`✅ Sesión válida encontrada: ${sessionPath}`);
                return true;
            }
        }
        
        console.log(`❌ Sesión inválida (sin archivos): ${sessionPath}`);
        return false;
        
    } catch (error) {
        console.log(`❌ Error verificando sesión ${sessionPath}: ${error.message}`);
        return false;
    }
}

// Función mejorada para cargar sesiones existentes
function loadExistingSessions() {
    try {
        if (!fs.existsSync('./sessions')) {
            console.log('📂 Creando directorio de sesiones...');
            fs.mkdirSync('./sessions', { recursive: true });
            return;
        }
        
        const sessionDirs = fs.readdirSync('./sessions');
        let validSessions = 0;
        let skippedSessions = 0;
        let cleanedSessions = 0;
        
        console.log(`🔍 Verificando ${sessionDirs.length} carpetas de sesión...`);
        
        for (const sessionId of sessionDirs) {
            if (sessionId.startsWith('session_')) {
                const sessionPath = `./sessions/${sessionId}`;
                
                try {
                    const stats = fs.statSync(sessionPath);
                    const maxAge = new Date(Date.now() - ROBUST_CONFIG.SESSION_TIMEOUT_HOURS * 60 * 60 * 1000);
                    
                    // Verificar si tiene archivos válidos
                    const hasValidFiles = hasValidSessionFiles(sessionPath);
                    
                    // Borrar si no tiene archivos válidos O es muy antigua
                    if (!hasValidFiles || stats.mtime < maxAge) {
                        console.log(`🗑️ Borrando sesión ${hasValidFiles ? 'antigua' : 'vacía'}: ${sessionId}`);
                        fs.rmSync(sessionPath, { recursive: true });
                        cleanedSessions++;
                        continue;
                    }
                    
                    // Solo cargar si tenemos espacio para más sesiones
                    if (validSessions >= ROBUST_CONFIG.MAX_AUTO_RECONNECTS) {
                        console.log(`⏭️ Saltando sesión (límite alcanzado): ${sessionId}`);
                        skippedSessions++;
                        continue;
                    }
                    
                    const shortId = sessionId.split('_').pop();
                    console.log(`🔄 Cargando sesión válida: ${shortId}`);
                    
                    sessions.set(sessionId, {
                        status: 'reconnecting',
                        qr: null,
                        deviceNumber: null,
                        error: null,
                        lastUpdate: new Date(),
                        reconnectAttempts: 0,
                        sessionPath: sessionPath
                    });
                    
                    // Reconectar con delay escalonado
                    setTimeout(() => {
                        connectWhatsApp(sessionId);
                    }, 3000 + (validSessions * 2000));
                    
                    validSessions++;
                    
                } catch (e) {
                    console.log(`❌ Error procesando ${sessionId}, borrando: ${e.message}`);
                    try {
                        fs.rmSync(sessionPath, { recursive: true });
                        cleanedSessions++;
                    } catch (cleanError) {
                        console.error(`Error borrando sesión corrupta: ${cleanError.message}`);
                    }
                }
            }
        }
        
        console.log(`📊 Resultado carga: ${validSessions} reconectando, ${skippedSessions} omitidas, ${cleanedSessions} borradas`);
        
    } catch (error) {
        console.log(`⚠️ Error cargando sesiones: ${error.message}`);
    }
}

// Función mejorada de limpieza inteligente
function cleanupIntelligentSessions() {
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    let cleanedFiles = 0;
    let cleanedMemory = 0;
    
    try {
        // Limpiar archivos huérfanos y carpetas vacías
        if (fs.existsSync('./sessions')) {
            const sessionDirs = fs.readdirSync('./sessions');
            
            for (const sessionId of sessionDirs) {
                const sessionPath = getSessionPath(sessionId, session);
                const session = sessions.get(sessionId);
                
                let shouldDeleteFiles = false;
                let reason = '';
                
                // Verificar si tiene archivos válidos
                const hasValidFiles = hasValidSessionFiles(sessionPath);
                
                if (!hasValidFiles) {
                    reason = 'carpeta vacía/corrupta';
                    shouldDeleteFiles = true;
                } else if (session) {
                    // Sesión en memoria - aplicar reglas de tiempo
                    if (session.status === 'waiting_scan' && session.lastUpdate < thirtyMinutesAgo) {
                        reason = 'QR no escaneado (30+ min)';
                        shouldDeleteFiles = true;
                    } else if (['error', 'disconnected'].includes(session.status) && session.lastUpdate < twoHoursAgo) {
                        reason = 'sesión fallida antigua (2+ horas)';
                        shouldDeleteFiles = true;
                    } else if (session.status === 'unauthorized' && session.lastUpdate < thirtyMinutesAgo) {
                        reason = 'usuario no autorizado (30+ min)';
                        shouldDeleteFiles = true;
                    }
                } else {
                    // Archivos sin sesión en memoria - borrar si son muy antiguos
                    try {
                        const stats = fs.statSync(sessionPath);
                        if (stats.mtime < twentyFourHoursAgo) {
                            reason = 'archivos huérfanos antiguos (24+ horas)';
                            shouldDeleteFiles = true;
                        }
                    } catch (e) {
                        reason = 'error accediendo archivos';
                        shouldDeleteFiles = true;
                    }
                }
                
                if (shouldDeleteFiles) {
                    console.log(`🗑️ Limpiando sesión: ${sessionId} (${reason})`);
                    try {
                        fs.rmSync(sessionPath, { recursive: true });
                        sessions.delete(sessionId);
                        cleanedFiles++;
                    } catch (e) {
                        console.error(`Error limpiando ${sessionPath}:`, e.message);
                    }
                }
            }
        }
        
        // Limpiar memoria de sesiones desconectadas hace tiempo
        for (const [sessionId, session] of sessions.entries()) {
            if (['disconnected', 'error', 'unauthorized'].includes(session.status) && 
                session.lastUpdate < twoHoursAgo) {
                console.log(`🧹 Removiendo de memoria: ${sessionId} (${session.status})`);
                sessions.delete(sessionId);
                cleanedMemory++;
            }
        }
        
        const activeConnections = Array.from(sessions.values()).filter(s => s.status === 'connected').length;
        console.log(`📊 Limpieza completada: ${cleanedFiles} archivos, ${cleanedMemory} memoria. Conectadas: ${activeConnections}/${sessions.size}`);
        
    } catch (error) {
        console.error(`❌ Error en limpieza: ${error.message}`);
    }
}

// SISTEMA DE LOGGING MEJORADO
function logStateChange(sessionId, newState, data = {}) {
    const prevState = sessionLogState.get(sessionId) || {}
    const hasChanged = prevState.status !== newState || 
                      prevState.hasQR !== !!data.qr || 
                      prevState.deviceNumber !== data.deviceNumber ||
                      prevState.error !== data.error

    if (!hasChanged) return // No hacer log si no hay cambios

    // Actualizar estado de logging
    sessionLogState.set(sessionId, {
        status: newState,
        hasQR: !!data.qr,
        deviceNumber: data.deviceNumber,
        error: data.error,
        lastLog: new Date()
    })

    // Generar log solo si hay cambios
    const statusEmoji = {
        'initializing': '⚡',
        'connecting': '🔌',
        'waiting_scan': '📱',
        'connected': '✅',
        'disconnected': '❌',
        'error': '💥',
        'unauthorized': '🚫'
    }

    const emoji = statusEmoji[newState] || '📊'
    const shortId = sessionId.split('_').pop()
    
    console.log(`${emoji} [${shortId}] ${newState.toUpperCase()}${data.deviceNumber ? ` (+${data.deviceNumber})` : ''}${data.error ? ` - ${data.error}` : ''}`)
    
    // Log adicional solo para estados importantes
    if (newState === 'connected' && data.userName) {
        console.log(`👤 [${shortId}] Usuario: ${data.userName} (Agencia: ${data.userAgent})`)
    }
}

function logMessage(sessionId, direction, fromPhone, toPhone, messageText) {
    const shortId = sessionId.split('_').pop()
    const arrow = direction === 'ENVIADO' ? '→' : '←'
    const truncated = messageText.length > 50 ? messageText.substring(0, 47) + '...' : messageText
    console.log(`💬 [${shortId}] ${arrow} +${fromPhone} → +${toPhone}: "${truncated}"`)
}

function normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return null
    
    let normalized = phoneNumber.replace(/[^0-9]/g, '')
    
    if (normalized.startsWith('34') && normalized.length === 11) {
        normalized = normalized.substring(2)
    }
    
    return normalized
}

// Extrae la primera URL de un texto
function firstUrl(text) {
  if (!text) return null
  const m = text.match(/https?:\/\/\S+/i)
  return m ? m[0] : null
}

// Función para usar getUrlInfo de Baileys
async function getLinkPreviewWithBaileys(url) {
    try {
        console.log(`🔗 Usando getUrlInfo de Baileys para: ${url}`)
        
        const linkPreview = await getUrlInfo(url, {
            thumbnailWidth: 1920,  
            fetchOpts: {
                timeout: 15000,    
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            }
        })
        
        console.log(`✅ LinkPreview obtenido:`, {
            canonicalUrl: linkPreview['canonical-url'],
            title: linkPreview.title,
            description: linkPreview.description?.substring(0, 50),
            hasJpegThumbnail: !!linkPreview.jpegThumbnail,
            jpegThumbnailSize: linkPreview.jpegThumbnail?.length || 0,
            hasHighQualityThumbnail: !!linkPreview.highQualityThumbnail,
            originalThumbnailUrl: linkPreview.originalThumbnailUrl
        })
        
        // Si no hay jpegThumbnail pero hay highQualityThumbnail, intentar usarlo
        if (!linkPreview.jpegThumbnail && linkPreview.highQualityThumbnail) {
            console.log(`🔄 Usando highQualityThumbnail como jpegThumbnail`)
            linkPreview.jpegThumbnail = linkPreview.highQualityThumbnail.jpegThumbnail
        }
        
        // ✅ NUEVA FUNCIONALIDAD: Descargar imagen manualmente si no existe
        if (!linkPreview.jpegThumbnail && linkPreview.originalThumbnailUrl) {
            console.log(`📥 Descargando imagen manualmente: ${linkPreview.originalThumbnailUrl}`)
            
            try {
                // Convertir HTTP a HTTPS si es necesario
                let imageUrl = linkPreview.originalThumbnailUrl
                if (imageUrl.startsWith('http://')) {
                    imageUrl = imageUrl.replace('http://', 'https://')
                    console.log(`🔒 Convirtiendo a HTTPS: ${imageUrl}`)
                }
                
                const imageResponse = await axios.get(imageUrl, {
                    responseType: 'arraybuffer',
                    timeout: 10000,
                    maxContentLength: 500000, // Máximo 500KB
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'image/*',
                        'Referer': url  // Añadir referer para evitar bloqueos
                    }
                })
                
                const imageBuffer = Buffer.from(imageResponse.data)
                
                if (imageBuffer.length > 0 && imageBuffer.length < 500000) {
                    linkPreview.jpegThumbnail = imageBuffer
                    console.log(`✅ Imagen descargada manualmente: ${imageBuffer.length} bytes`)
                } else {
                    console.log(`⚠️ Imagen muy grande o vacía: ${imageBuffer.length} bytes`)
                }
                
            } catch (imageError) {
                console.log(`❌ Error descargando imagen manualmente: ${imageError.message}`)
                
                // Si HTTPS falla, intentar con HTTP original
                if (linkPreview.originalThumbnailUrl.startsWith('http://')) {
                    try {
                        console.log(`🔄 Reintentando con HTTP original: ${linkPreview.originalThumbnailUrl}`)
                        
                        const imageResponse = await axios.get(linkPreview.originalThumbnailUrl, {
                            responseType: 'arraybuffer',
                            timeout: 10000,
                            maxContentLength: 500000,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                'Accept': 'image/*',
                                'Referer': url
                            }
                        })
                        
                        const imageBuffer = Buffer.from(imageResponse.data)
                        
                        if (imageBuffer.length > 0 && imageBuffer.length < 500000) {
                            linkPreview.jpegThumbnail = imageBuffer
                            console.log(`✅ Imagen descargada con HTTP: ${imageBuffer.length} bytes`)
                        }
                        
                    } catch (httpError) {
                        console.log(`❌ Error también con HTTP: ${httpError.message}`)
                    }
                }
            }
        }
        
        // Log final
        console.log(`📊 LinkPreview final:`, {
            hasTitle: !!linkPreview.title,
            hasDescription: !!linkPreview.description,
            hasImage: !!linkPreview.jpegThumbnail,
            finalImageSize: linkPreview.jpegThumbnail?.length || 0
        })
        
        return linkPreview
        
    } catch (error) {
        console.log(`❌ Error en getUrlInfo: ${error.message}`)
        return null
    }
}

// Función para manejar teléfonos duplicados
function handleDuplicatePhone(newSessionId, phoneNumber) {
    if (!phoneNumber) return
    
    console.log(`🔍 Verificando duplicados para teléfono: +${phoneNumber}`)
    
    for (const [sessionId, session] of sessions.entries()) {
        if (sessionId !== newSessionId && 
            session.deviceNumber === phoneNumber && 
            session.status === 'connected') {
            
            console.log(`⚠️ Teléfono duplicado detectado! Cerrando sesión anterior: ${sessionId}`)
            
            // Cerrar conexión anterior
            if (session.socket) {
                try {
                    session.socket.end()
                } catch (e) {}
            }
            
            // Marcar como reemplazada
            sessions.set(sessionId, {
                ...session,
                status: 'replaced',
                error: `Reemplazada por nueva conexión`,
                socket: null,
                lastUpdate: new Date()
            })
            
            // Borrar archivos de la sesión anterior
            const oldSessionPath = session.sessionPath || `./sessions/${sessionId}`;
            if (fs.existsSync(oldSessionPath)) {
                try {
                    fs.rmSync(oldSessionPath, { recursive: true })
                    console.log(`🗑️ Archivos de sesión anterior borrados: ${sessionId}`)
                } catch (e) {
                    console.error(`Error borrando sesión anterior:`, e.message)
                }
            }
            
            break // Solo reemplazar la primera encontrada
        }
    }
}

// Cargar sesiones al iniciar
loadExistingSessions()

// Procesar batch de webhooks cada X segundos
setInterval(() => {
    processBatchWebhooks()
}, WEBHOOK_CONFIG.batchInterval)

// Procesar webhooks fallidos cada 30 segundos
setInterval(() => {
    if (failedWebhooks.length > 0) {
        console.log(`🔄 Reintentando ${failedWebhooks.length} webhooks fallidos`)
        webhookBatch.unshift(...failedWebhooks.splice(0, 10)) // Mover 10 fallidos al batch principal
    }
}, 30000)

// Limpiar sesiones viejas cada 15 minutos
setInterval(() => {
    cleanupIntelligentSessions()
}, ROBUST_CONFIG.CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000)

// Middleware para parsear JSON
app.use(express.json())

// Endpoint para enviar mensajes
app.post('/api/send-message', authMiddleware, async (req, res) => {
    try {
        const { telefono_origen, telefono_destino, mensaje } = req.body

        console.log(`🔍 DEBUG - Request recibido:`, {
            telefono_origen,
            telefono_destino,
            mensaje: mensaje?.substring(0, 50) + '...'
        })


        // Validar campos requeridos
        if (!telefono_origen || !telefono_destino || !mensaje) {
            return res.status(400).json({
                success: false,
                error: 'Faltan campos requeridos: telefono_origen, telefono_destino, mensaje'
            })
        }

        // Normalizar números
        let origenNormalizado = normalizePhoneNumber(telefono_origen)
        let destinoNormalizado = normalizePhoneNumber(telefono_destino)

        console.log(`🔍 DEBUG - Números después de normalizar:`, {
            origenNormalizado,
            destinoNormalizado
        })

        // DEBUG: Ver todas las sesiones
        console.log(`🔍 DEBUG - Sesiones disponibles:`)
        for (const [sessionId, session] of sessions.entries()) {
            console.log(`  ${sessionId}: status=${session.status}, deviceNumber=${session.deviceNumber}, hasSocket=${!!session.socket}`)
        }

        // Buscar sesión conectada con el teléfono origen
        let sessionFound = null
        let socketFound = null

        for (const [sessionId, session] of sessions.entries()) {
            const normalizedDeviceNumber = normalizePhoneNumber(session.deviceNumber)
            const shortId = sessionId.split('_').pop()
            
            console.log(`   Comparando [${shortId}]: "${normalizedDeviceNumber}" === "${origenNormalizado}" ? ${normalizedDeviceNumber === origenNormalizado}`)
            
            if (session.status === 'connected' && 
                normalizedDeviceNumber === origenNormalizado && 
                session.socket) {
                sessionFound = sessionId
                socketFound = session.socket
                console.log(`✅ DEBUG - Sesión encontrada: [${shortId}]`)
                break
            }
        }

        if (!sessionFound) {
            console.log('❌ DEBUG - No se encontró sesión válida')
            return res.status(404).json({
                success: false,
                error: `No se encontró sesión conectada para el teléfono ${telefono_origen}`,
                debug: {
                    origenNormalizado,
                    totalSessions: sessions.size,
                    availableNormalizedPhones: Array.from(sessions.values())
                        .filter(s => s.status === 'connected' && s.deviceNumber)
                        .map(s => normalizePhoneNumber(s.deviceNumber))
                },
                available_phones: Array.from(sessions.values())
                    .filter(s => s.status === 'connected' && s.deviceNumber)
                    .map(s => s.deviceNumber)
            })
        }

        // Formatear número destino para WhatsApp (añadir prefijo si no lo tiene)
        let destinoWhatsApp = destinoNormalizado
        if (!destinoWhatsApp.startsWith('34') && destinoWhatsApp.length === 9) {
            destinoWhatsApp = '34' + destinoWhatsApp
        }
        destinoWhatsApp = destinoWhatsApp + '@s.whatsapp.net'

        // Enviar mensaje
        console.log(`📤 DEBUG - Enviando mensaje vía [${sessionFound.split('_').pop()}] a ${destinoWhatsApp}`)
        
        let messageResult = null
        const url = firstUrl(mensaje)

        if (url) {
            console.log(`🔗 URL detectada, generando preview con getUrlInfo: ${url}`)
            
            try {
                const linkPreview = await getLinkPreviewWithBaileys(url)
                
                if (linkPreview) {
                    console.log(`✅ LinkPreview generado con getUrlInfo`)
                    
                    // Enviar mensaje con linkPreview de Baileys
                    messageResult = await socketFound.sendMessage(destinoWhatsApp, {
                        text: mensaje,
                        linkPreview: linkPreview  // Usar directamente el objeto de getUrlInfo
                    })
                    
                } else {
                    // Fallback: mensaje sin linkPreview
                    console.log(`⚠️ Enviando sin linkPreview`)
                    messageResult = await socketFound.sendMessage(destinoWhatsApp, {
                        text: mensaje
                    })
                }
                
            } catch (error) {
                console.log(`❌ Error enviando mensaje con linkPreview: ${error.message}`)
                // Enviar mensaje sin linkPreview
                messageResult = await socketFound.sendMessage(destinoWhatsApp, {
                    text: mensaje
                })
            }
            
        } else {
            console.log(`📝 Mensaje sin URLs`)
            messageResult = await socketFound.sendMessage(destinoWhatsApp, {
                text: mensaje
            })
        }

        console.log(`📤 Mensaje API enviado: +${origenNormalizado} → +${destinoNormalizado}: "${mensaje.substring(0, 50)}..."`)

        res.json({
            success: true,
            message: 'Mensaje enviado correctamente',
            data: {
                session: sessionFound,
                telefono_origen: origenNormalizado,
                telefono_destino: destinoNormalizado,
                mensaje: mensaje,
                messageId: messageResult.key.id,
                timestamp: new Date().toISOString()
            }
        })

    } catch (error) {
        console.error('Error enviando mensaje API:', error)
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor: ' + error.message
        })
    }
})

// Endpoint de depuración: verificar usuario por teléfono (GET /debug/user?phone=...)
app.get('/debug/user', async (req, res) => {
    const phone = req.query.phone
    if (!phone) return res.status(400).json({ error: 'phone query required' })

    try {
        const user = await verificarYRegistrarUsuario('debug', phone)
        return res.json({ phone, user })
    } catch (e) {
        return res.status(500).json({ error: e.message })
    }
})

// Endpoint para verificar sesiones activas
app.get('/api/sessions', authMiddleware, (req, res) => {
    const activeSessions = []
    
    for (const [sessionId, session] of sessions.entries()) {
        if (session.status === 'connected') {
            activeSessions.push({
                sessionId: sessionId,
                phoneNumber: session.deviceNumber,
                userName: session.userData ? `${session.userData.Nombre} ${session.userData.Apellidos}` : null,
                userAgent: session.userData ? session.userData.IdAgencia : null,
                status: session.status,
                lastUpdate: session.lastUpdate,
                syncEnabled: session.userData ? session.userData.SyncConversaciones === 1 : false
            })
        }
    }
    
    res.json({
        success: true,
        activeSessions: activeSessions,
        total: activeSessions.length,
        timestamp: new Date().toISOString()
    })
})


// Iniciar servidor
app.listen(3000, '0.0.0.0', () => {
    console.log('🌐 WHATSAPP MULTI-CONNECTOR INICIADO EN PUERTO 3000')
    console.log('📡 Webhook URL: http://host.docker.internal:8081/api/whatsapp_node_webhook.php')
})
