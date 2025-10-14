const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const QRCode = require('qrcode')
const fs = require('fs')

const app = express()
let qrCodeData = null
let connectionStatus = 'Iniciando...'
let deviceNumber = null
let isConnecting = false

// Limpiar sesiones anteriores para empezar fresh
if (fs.existsSync('./auth_info')) {
    fs.rmSync('./auth_info', { recursive: true })
    console.log('??? Limpiando sesiones anteriores...')
}

// Servir página web con QR
app.get('/', async (req, res) => {
    let qrImage = ''
    if (qrCodeData) {
        try {
            qrImage = await QRCode.toDataURL(qrCodeData, { 
                width: 300,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                }
            })
        } catch (e) {
            console.error('Error generando QR imagen:', e)
        }
    }
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp QR - Hipotea</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { 
                    font-family: 'Segoe UI', Arial, sans-serif; 
                    text-align: center; 
                    padding: 20px; 
                    background: linear-gradient(135deg, #f7913e 0%, #ff6b35 100%);
                    margin: 0;
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                .container {
                    background: white;
                    padding: 40px;
                    border-radius: 20px;
                    box-shadow: 0 15px 35px rgba(0,0,0,0.1);
                    max-width: 600px;
                    width: 90%;
                    position: relative;
                }
                .status { 
                    font-size: 28px; 
                    margin: 25px 0; 
                    font-weight: bold;
                    padding: 15px;
                    border-radius: 10px;
                }
                .qr-container { 
                    margin: 30px 0; 
                    padding: 20px;
                    background: #f8f9fa;
                    border-radius: 15px;
                }
                .qr-image { 
                    max-width: 280px; 
                    width: 100%;
                    border: 3px solid #f7913e;
                    border-radius: 15px;
                    box-shadow: 0 8px 25px rgba(0,0,0,0.1);
                    background: white;
                    padding: 15px;
                }
                .connected { 
                    background: #d4edda; 
                    color: #155724; 
                    border: 2px solid #c3e6cb;
                }
                .disconnected { 
                    background: #f8d7da; 
                    color: #721c24; 
                    border: 2px solid #f5c6cb;
                }
                .waiting { 
                    background: #fff3cd; 
                    color: #856404; 
                    border: 2px solid #ffeaa7;
                }
                .initializing {
                    background: #e2e3e5;
                    color: #383d41;
                    border: 2px solid #d6d8db;
                }
                .instructions {
                    background: white;
                    padding: 20px;
                    border-radius: 12px;
                    margin-top: 20px;
                    text-align: left;
                    font-size: 16px;
                    border-left: 5px solid #f7913e;
                }
                .instructions ol {
                    margin: 0;
                    padding-left: 20px;
                }
                .instructions li {
                    margin: 8px 0;
                    font-weight: 500;
                }
                .loading {
                    display: inline-block;
                    width: 50px;
                    height: 50px;
                    border: 5px solid #f3f3f3;
                    border-top: 5px solid #f7913e;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 25px;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .logo {
                    color: #f7913e;
                    font-size: 2.5em;
                    margin-bottom: 10px;
                }
                .footer {
                    color: #666; 
                    font-size: 12px; 
                    margin-top: 30px;
                    border-top: 1px solid #eee;
                    padding-top: 15px;
                }
                .refresh-info {
                    background: #e7f3ff;
                    padding: 10px;
                    border-radius: 8px;
                    font-size: 14px;
                    color: #0366d6;
                    margin-top: 15px;
                }
            </style>
            <script>
                // Auto-refresh cada 2 segundos solo si no está conectado
                let shouldRefresh = ${connectionStatus !== 'Conectado'};
                if (shouldRefresh) {
                    setTimeout(() => {
                        console.log('Refrescando página...');
                        location.reload();
                    }, 2000);
                }
                
                // Mostrar tiempo de última actualización
                window.onload = function() {
                    const now = new Date();
                    const timeStr = now.toLocaleTimeString();
                    document.getElementById('lastUpdate').textContent = timeStr;
                }
            </script>
        </head>
        <body>
            <div class="container">
                <div class="logo">??</div>
                <h1 style="color: #333; margin: 0 0 10px 0;">Hipotea WhatsApp</h1>
                <p style="color: #666; margin: 0 0 30px 0;">Sistema de Conexión</p>
                
                <div class="status ${
                    connectionStatus === 'Conectado' ? 'connected' : 
                    connectionStatus === 'Esperando QR' ? 'waiting' : 
                    connectionStatus === 'Iniciando...' ? 'initializing' : 'disconnected'
                }">
                    ${connectionStatus}
                    ${deviceNumber ? `<br><small style="font-weight: normal;">?? +${deviceNumber}</small>` : ''}
                </div>
                
                ${qrImage ? `
                    <div class="qr-container">
                        <h2 style="color: #333; margin-top: 0;">?? Escanea con tu WhatsApp</h2>
                        <img src="${qrImage}" alt="Código QR de WhatsApp" class="qr-image">
                        
                        <div class="instructions">
                            <strong style="color: #f7913e;">Instrucciones:</strong>
                            <ol>
                                <li>Abre <strong>WhatsApp</strong> en tu teléfono</li>
                                <li>Ve a <strong>Configuración ??</strong></li>
                                <li>Toca <strong>"Dispositivos conectados"</strong></li>
                                <li>Selecciona <strong>"Conectar dispositivo"</strong></li>
                                <li>Apunta tu cámara a este código QR</li>
                            </ol>
                        </div>
                    </div>
                ` : connectionStatus === 'Conectado' ? `
                    <div style="margin: 40px 0;">
                        <div style="font-size: 64px; margin: 20px 0;">?</div>
                        <h2 style="color: #28a745; margin: 0;">¡Conexión Exitosa!</h2>
                        <p style="color: #666;">WhatsApp está conectado y listo para usar</p>
                    </div>
                ` : `
                    <div style="margin: 40px 0;">
                        <div class="loading"></div>
                        <p style="color: #666; margin: 20px 0;">Preparando conexión a WhatsApp...</p>
                        <div class="refresh-info">
                            ? Esto puede tomar unos segundos. La página se actualiza automáticamente.
                        </div>
                    </div>
                `}
                
                <div class="footer">
                    <strong>Hipotea</strong> - Gestión Inmobiliaria Inteligente<br>
                    Última actualización: <span id="lastUpdate"></span>
                    ${connectionStatus !== 'Conectado' ? '<br>?? Actualizando cada 2 segundos...' : ''}
                </div>
            </div>
        </body>
        </html>
    `)
})

// Variable para controlar reconexiones
let reconnectAttempts = 0
const maxReconnectAttempts = 3

// Función para conectar a WhatsApp con configuración más robusta
async function connectToWhatsApp() {
    if (isConnecting) {
        console.log('?? Ya hay una conexión en progreso, saltando...')
        return
    }
    
    isConnecting = true
    reconnectAttempts++
    
    try {
        console.log(`?? Intento de conexión ${reconnectAttempts}/${maxReconnectAttempts}`)
        connectionStatus = 'Iniciando conexión...'
        
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info')
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: require('pino')({ level: 'fatal' }), // Solo errores críticos
            browser: ['Hipotea Desktop', 'Desktop', '1.0.0'], // Identificador único
            markOnlineOnConnect: false, // No marcar como online automáticamente
            connectTimeoutMs: 30000, // 30 segundos timeout
            defaultQueryTimeoutMs: 30000,
            keepAliveIntervalMs: 25000,
            qrTimeout: 40000, // 40 segundos para el QR
            linkPreviewImageThumbnailWidth: 192,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            shouldSyncHistoryMessage: () => false,
            getMessage: async (key) => undefined,
            // Configuración de red más permisiva
            retryRequestDelayMs: 250,
            maxMsgRetryCount: 3,
            // Evitar sincronización innecesaria
            emitOwnEvents: false,
            fireInitQueries: true,
            shouldIgnoreJid: () => false
        })

        sock.ev.on('creds.update', saveCreds)

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update
            
            if (qr) {
                qrCodeData = qr
                connectionStatus = 'Esperando QR'
                console.log('? CÓDIGO QR GENERADO EXITOSAMENTE!')
                console.log('?? Ve a: http://localhost:3000')
                console.log('?? Escanea el QR con tu WhatsApp')
                
                // Reset attempts cuando tenemos QR exitoso
                reconnectAttempts = 0
            }
            
            if (connection === 'close') {
                isConnecting = false
                const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut
                const errorCode = (lastDisconnect?.error instanceof Boom)?.output?.statusCode
                const errorMsg = lastDisconnect?.error?.message || 'Error desconocido'
                
                connectionStatus = 'Desconectado'
                qrCodeData = null
                deviceNumber = null
                
                console.log(`? Conexión cerrada: ${errorMsg}`)
                console.log(`?? Código de error: ${errorCode}`)
                
                if (shouldReconnect && reconnectAttempts <= maxReconnectAttempts) {
                    const delay = Math.min(1000 * reconnectAttempts, 10000) // Max 10 segundos
                    console.log(`?? Reintentando en ${delay/1000} segundos... (${reconnectAttempts}/${maxReconnectAttempts})`)
                    setTimeout(() => connectToWhatsApp(), delay)
                } else if (reconnectAttempts > maxReconnectAttempts) {
                    console.log('?? Máximo de reintentos alcanzado. Revisa tu conexión a internet.')
                    connectionStatus = 'Error de conexión - Revisa tu internet'
                } else {
                    console.log('?? No se reintentará la conexión (sesión cerrada)')
                    connectionStatus = 'Sesión cerrada'
                }
            } else if (connection === 'open') {
                isConnecting = false
                reconnectAttempts = 0
                connectionStatus = 'Conectado'
                qrCodeData = null
                
                try {
                    if (sock.user && sock.user.id) {
                        deviceNumber = sock.user.id.split(':')[0].replace(/[^0-9]/g, '')
                    }
                } catch (e) {
                    console.log('?? No se pudo obtener el número del dispositivo:', e.message)
                }
                
                console.log('?? ¡WHATSAPP CONECTADO CORRECTAMENTE!')
                if (deviceNumber) {
                    console.log('?? Número conectado: +' + deviceNumber)
                }
                console.log('? Sistema listo para enviar y recibir mensajes')
            } else if (connection === 'connecting') {
                connectionStatus = 'Conectando a WhatsApp...'
                console.log('?? Conectando a WhatsApp...')
            }
        })

        // Manejar mensajes recibidos (opcional)
        sock.ev.on('messages.upsert', (m) => {
            const messages = m.messages || []
            for (const msg of messages) {
                if (!msg.key.fromMe && msg.message) {
                    const from = msg.key.remoteJid.split('@')[0]
                    let messageText = ''
                    
                    if (msg.message.conversation) {
                        messageText = msg.message.conversation
                    } else if (msg.message.extendedTextMessage) {
                        messageText = msg.message.extendedTextMessage.text
                    }
                    
                    if (messageText && messageText.length > 0) {
                        console.log(`?? [${from}]: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}`)
                    }
                }
            }
        })

    } catch (error) {
        isConnecting = false
        console.error('? Error crítico en connectToWhatsApp:', error.message)
        connectionStatus = 'Error: ' + error.message
        
        if (reconnectAttempts <= maxReconnectAttempts) {
            console.log(`?? Reintentando por error en ${5000}ms... (${reconnectAttempts}/${maxReconnectAttempts})`)
            setTimeout(() => connectToWhatsApp(), 5000)
        } else {
            console.log('?? Demasiados errores. Deteniendo intentos.')
            connectionStatus = 'Error crítico - Reinicia la aplicación'
        }
    }
}

// Iniciar servidor web
app.listen(3000, '0.0.0.0', () => {
    console.log('?? Servidor WhatsApp iniciado en: http://localhost:3000')
    console.log('?? Versión optimizada con mejor manejo de errores')
    console.log('?? Iniciando proceso de conexión...')
    console.log('')
})

// Pequeño delay antes de iniciar
setTimeout(() => {
    connectToWhatsApp()
}, 1000)

// Manejar cierre graceful
process.on('SIGINT', () => {
    console.log('?? Cerrando aplicación...')
    process.exit(0)
})

process.on('SIGTERM', () => {
    console.log('?? Aplicación terminada')
    process.exit(0)
})