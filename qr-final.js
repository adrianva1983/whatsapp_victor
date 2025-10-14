const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const QRCode = require('qrcode')
const fs = require('fs')

console.log('?? Iniciando WhatsApp QR Generator - Hipotea')
console.log('?? Usando paquete oficial "baileys"')

const app = express()
let qrCodeData = null
let connectionStatus = 'Preparando...'
let deviceNumber = null

// Limpiar sesiones anteriores
try {
    if (fs.existsSync('./auth_info')) {
        fs.rmSync('./auth_info', { recursive: true })
        console.log('??? Limpiado: Sesiones anteriores eliminadas')
    }
} catch (e) {
    console.log('?? No se pudo limpiar sesiones anteriores:', e.message)
}

// Servir página web
app.get('/', async (req, res) => {
    let qrImage = ''
    if (qrCodeData) {
        try {
            qrImage = await QRCode.toDataURL(qrCodeData, { 
                width: 256,
                margin: 2
            })
        } catch (e) {
            console.error('? Error generando imagen QR:', e.message)
        }
    }
    
    const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Hipotea WhatsApp QR</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 20px;
                }
                .card { 
                    background: white;
                    padding: 40px;
                    border-radius: 20px;
                    box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                    text-align: center;
                    max-width: 500px;
                    width: 100%;
                }
                .logo { 
                    font-size: 48px; 
                    margin-bottom: 20px; 
                }
                .title { 
                    color: #333;
                    font-size: 28px;
                    font-weight: 600;
                    margin-bottom: 10px;
                }
                .subtitle { 
                    color: #666;
                    font-size: 16px;
                    margin-bottom: 30px;
                }
                .status { 
                    padding: 15px 25px;
                    border-radius: 25px;
                    font-weight: 600;
                    font-size: 18px;
                    margin-bottom: 30px;
                    display: inline-block;
                }
                .status.connected { background: #d4edda; color: #155724; }
                .status.waiting { background: #fff3cd; color: #856404; }
                .status.error { background: #f8d7da; color: #721c24; }
                .status.preparing { background: #e2e3e5; color: #383d41; }
                
                .qr-section { 
                    background: #f8f9fa;
                    padding: 30px;
                    border-radius: 15px;
                    margin: 20px 0;
                }
                .qr-image { 
                    max-width: 100%;
                    border: 3px solid #667eea;
                    border-radius: 15px;
                    background: white;
                    padding: 10px;
                }
                .instructions { 
                    background: white;
                    padding: 20px;
                    border-radius: 12px;
                    text-align: left;
                    margin-top: 20px;
                    border-left: 4px solid #667eea;
                }
                .instructions h4 { 
                    color: #667eea;
                    margin-bottom: 15px;
                    font-size: 18px;
                }
                .instructions ol { 
                    color: #333;
                    line-height: 1.6;
                }
                .instructions li { 
                    margin: 8px 0;
                    font-weight: 500;
                }
                
                .spinner {
                    border: 4px solid #f3f3f3;
                    border-top: 4px solid #667eea;
                    border-radius: 50%;
                    width: 50px;
                    height: 50px;
                    animation: spin 1s linear infinite;
                    margin: 20px auto;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                
                .success-icon { 
                    font-size: 64px; 
                    color: #28a745; 
                    margin: 20px 0;
                }
                
                .footer {
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 1px solid #eee;
                    color: #999;
                    font-size: 14px;
                }
                
                .auto-refresh {
                    background: #e7f3ff;
                    padding: 12px;
                    border-radius: 8px;
                    color: #0366d6;
                    font-size: 14px;
                    margin-top: 15px;
                }
            </style>
            ${connectionStatus !== 'Conectado' ? '<meta http-equiv="refresh" content="2">' : ''}
        </head>
        <body>
            <div class="card">
                <div class="logo">??</div>
                <h1 class="title">Hipotea WhatsApp</h1>
                <p class="subtitle">Conexión de WhatsApp Business</p>
                
                <div class="status ${
                    connectionStatus === 'Conectado' ? 'connected' : 
                    connectionStatus.includes('Esperando') ? 'waiting' : 
                    connectionStatus.includes('Error') ? 'error' : 'preparing'
                }">
                    ${connectionStatus}
                    ${deviceNumber ? `<br><small>?? +${deviceNumber}</small>` : ''}
                </div>
                
                ${qrImage ? `
                    <div class="qr-section">
                        <h3 style="margin-bottom: 20px; color: #333;">?? Escanea con WhatsApp</h3>
                        <img src="${qrImage}" alt="Código QR WhatsApp" class="qr-image">
                        
                        <div class="instructions">
                            <h4>?? Pasos para conectar:</h4>
                            <ol>
                                <li><strong>Abre WhatsApp</strong> en tu teléfono móvil</li>
                                <li>Ve a <strong>Configuración ??</strong> (menú de 3 puntos)</li>
                                <li>Selecciona <strong>"Dispositivos conectados"</strong></li>
                                <li>Toca <strong>"Conectar dispositivo"</strong></li>
                                <li><strong>Escanea este código QR</strong> con la cámara</li>
                            </ol>
                        </div>
                    </div>
                ` : connectionStatus === 'Conectado' ? `
                    <div class="success-icon">?</div>
                    <h2 style="color: #28a745; margin: 0 0 15px 0;">¡Conectado!</h2>
                    <p style="color: #666;">WhatsApp está conectado correctamente</p>
                ` : connectionStatus.includes('Error') ? `
                    <div style="font-size: 48px; margin: 20px 0; color: #dc3545;">??</div>
                    <p style="color: #666; margin: 20px 0;">
                        Hay un problema con la conexión.<br>
                        Verifica tu conexión a internet y reinicia la aplicación.
                    </p>
                ` : `
                    <div class="spinner"></div>
                    <p style="color: #666; margin: 20px 0;">Conectando a WhatsApp...</p>
                    <div class="auto-refresh">
                        ?? La página se actualiza automáticamente cada 2 segundos
                    </div>
                `}
                
                <div class="footer">
                    <strong>Hipotea</strong> - Gestión Inmobiliaria<br>
                    Última actualización: ${new Date().toLocaleTimeString()}
                </div>
            </div>
        </body>
        </html>
    `
    
    res.send(html)
})

// Función principal de conexión
async function conectarWhatsApp() {
    let intentos = 0
    const maxIntentos = 5
    
    async function intentarConexion() {
        intentos++
        console.log(`\n?? Intento ${intentos}/${maxIntentos} - Conectando a WhatsApp...`)
        
        try {
            connectionStatus = `Conectando... (${intentos}/${maxIntentos})`
            
            const { state, saveCreds } = await useMultiFileAuthState('./auth_info')
            
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: require('pino')({ level: 'fatal' }),
                browser: ['Hipotea', 'Chrome', '100.0.4896.127'],
                connectTimeoutMs: 20000,
                defaultQueryTimeoutMs: 20000,
                keepAliveIntervalMs: 30000,
                markOnlineOnConnect: false,
                syncFullHistory: false,
                generateHighQualityLinkPreview: false,
                getMessage: async () => undefined
            })

            sock.ev.on('creds.update', saveCreds)

            sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect, qr } = update
                
                if (qr) {
                    qrCodeData = qr
                    connectionStatus = 'Esperando escaneo del QR'
                    console.log('? ¡CÓDIGO QR GENERADO!')
                    console.log('?? Abre: http://localhost:3000')
                    console.log('?? Escanea el QR con tu WhatsApp')
                    intentos = 0 // Reset en caso de QR exitoso
                }
                
                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut
                    const reason = lastDisconnect?.error?.message || 'Motivo desconocido'
                    
                    console.log(`? Conexión cerrada: ${reason}`)
                    
                    connectionStatus = 'Desconectado'
                    qrCodeData = null
                    deviceNumber = null
                    
                    if (shouldReconnect && intentos < maxIntentos) {
                        const delay = Math.min(2000 * intentos, 10000) // 2s, 4s, 6s, 8s, 10s
                        console.log(`? Reintentando en ${delay/1000} segundos...`)
                        setTimeout(intentarConexion, delay)
                    } else if (intentos >= maxIntentos) {
                        console.log('?? Máximo de intentos alcanzado')
                        connectionStatus = 'Error: No se pudo conectar'
                    } else {
                        console.log('?? No se puede reconectar (sesión cerrada)')
                        connectionStatus = 'Sesión finalizada'
                    }
                } else if (connection === 'open') {
                    console.log('?? ¡WHATSAPP CONECTADO EXITOSAMENTE!')
                    connectionStatus = 'Conectado'
                    qrCodeData = null
                    intentos = 0
                    
                    try {
                        if (sock.user?.id) {
                            deviceNumber = sock.user.id.split(':')[0].replace(/[^0-9]/g, '')
                            console.log('?? Número: +' + deviceNumber)
                        }
                    } catch (e) {
                        console.log('?? No se pudo obtener número del dispositivo')
                    }
                }
            })

            // Log de mensajes recibidos
            sock.ev.on('messages.upsert', (m) => {
                m.messages?.forEach(msg => {
                    if (!msg.key.fromMe && msg.message?.conversation) {
                        const from = msg.key.remoteJid?.split('@')[0] || 'Desconocido'
                        const text = msg.message.conversation.substring(0, 40)
                        console.log(`?? [${from}]: ${text}...`)
                    }
                })
            })

        } catch (error) {
            console.error('? Error en intentarConexion:', error.message)
            connectionStatus = `Error: ${error.message}`
            
            if (intentos < maxIntentos) {
                console.log(`? Reintentando en 3 segundos...`)
                setTimeout(intentarConexion, 3000)
            } else {
                console.log('?? Demasiados errores')
                connectionStatus = 'Error crítico'
            }
        }
    }
    
    // Iniciar primer intento
    await intentarConexion()
}

// Inicializar servidor y WhatsApp
app.listen(3000, '0.0.0.0', async () => {
    console.log('?? Servidor iniciado en: http://localhost:3000')
    console.log('?? Estado: Preparando conexión...')
    console.log('? Usando paquete oficial "baileys"\n')
    
    // Esperar un poco antes de conectar
    setTimeout(() => {
        conectarWhatsApp()
    }, 500)
})

// Manejo graceful de cierre
process.on('SIGINT', () => {
    console.log('\n?? Aplicación cerrada por el usuario')
    process.exit(0)
})