const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const QRCode = require('qrcode')
const fs = require('fs')

const app = express()
let qrCodeData = null
let connectionStatus = 'Desconectado'
let deviceNumber = null

// Limpiar sesiones anteriores
if (fs.existsSync('./auth_info')) {
    fs.rmSync('./auth_info', { recursive: true })
}

// Servir página web con QR
app.get('/', async (req, res) => {
    let qrImage = ''
    if (qrCodeData) {
        try {
            qrImage = await QRCode.toDataURL(qrCodeData)
        } catch (e) {
            console.error('Error generando QR imagen:', e)
        }
    }
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp QR Code - Hipotea</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    text-align: center; 
                    padding: 20px; 
                    background: linear-gradient(135deg, #f7913e 0%, #ff6b35 100%);
                    margin: 0;
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                }
                .container {
                    background: white;
                    padding: 30px;
                    border-radius: 20px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                    max-width: 500px;
                    width: 90%;
                }
                .status { 
                    font-size: 24px; 
                    margin: 20px; 
                    font-weight: bold;
                }
                .qr { margin: 20px; }
                img { 
                    max-width: 300px; 
                    border: 5px solid #f7913e;
                    border-radius: 15px;
                    box-shadow: 0 5px 15px rgba(0,0,0,0.1);
                }
                .connected { color: #28a745; }
                .disconnected { color: #dc3545; }
                .waiting { color: #ffc107; }
                .logo {
                    width: 120px;
                    margin-bottom: 20px;
                }
                .instructions {
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 10px;
                    margin-top: 20px;
                    text-align: left;
                    font-size: 14px;
                }
                .loading {
                    display: inline-block;
                    width: 40px;
                    height: 40px;
                    border: 4px solid #f3f3f3;
                    border-top: 4px solid #f7913e;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 20px;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
            <script>
                setTimeout(() => location.reload(), 3000);
            </script>
        </head>
        <body>
            <div class="container">
                <h1 style="color: #f7913e; margin-top: 0;">?? Hipotea WhatsApp</h1>
                
                <div class="status ${connectionStatus === 'Conectado' ? 'connected' : connectionStatus === 'Esperando QR' ? 'waiting' : 'disconnected'}">
                    ${connectionStatus}
                </div>
                
                ${deviceNumber ? `<p><strong>Número:</strong> +${deviceNumber}</p>` : ''}
                
                ${qrImage ? `
                    <div class="qr">
                        <h2>?? Escanea con WhatsApp</h2>
                        <img src="${qrImage}" alt="QR Code">
                        
                        <div class="instructions">
                            <strong>Pasos para conectar:</strong><br>
                            1?? Abre WhatsApp en tu teléfono<br>
                            2?? Ve a ?? <strong>Configuración</strong><br>
                            3?? Toca <strong>Dispositivos conectados</strong><br>
                            4?? Toca <strong>+ Conectar dispositivo</strong><br>
                            5?? <strong>Escanea este código QR</strong>
                        </div>
                    </div>
                ` : connectionStatus === 'Conectado' ? 
                    '<div style="color: #28a745; font-size: 48px;">?</div><h2>¡Conectado correctamente!</h2>' : 
                    '<div class="loading"></div><p>Generando código QR...</p>'
                }
                
                <p style="color: #666; font-size: 12px; margin-top: 30px;">
                    Hipotea - Gestión Inmobiliaria<br>
                    La página se actualiza automáticamente cada 3 segundos
                </p>
            </div>
        </body>
        </html>
    `)
})

// Función para conectar a WhatsApp con configuración optimizada
async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info')
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: require('pino')({ level: 'silent' }), // Silenciar logs para evitar spam
            browser: ['WhatsApp Business', 'Chrome', '110.0.5481.77'], // User agent más confiable
            markOnlineOnConnect: false,
            connectTimeoutMs: 60000, // Timeout más alto
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            linkPreviewImageThumbnailWidth: 192,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            shouldSyncHistoryMessage: () => false,
            getMessage: async (key) => undefined
        })

        sock.ev.on('creds.update', saveCreds)

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update
            
            if (qr) {
                qrCodeData = qr
                connectionStatus = 'Esperando QR'
                console.log('? QR GENERADO - Ve a http://localhost:3000 para escanearlo')
                console.log('?? El QR debe aparecer ahora en la página web')
            }
            
            if (connection === 'close') {
                connectionStatus = 'Desconectado'
                qrCodeData = null
                deviceNumber = null
                
                const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut
                const errorCode = (lastDisconnect?.error instanceof Boom)?.output?.statusCode
                
                console.log('? Conexión cerrada:', lastDisconnect?.error?.message || 'Error desconocido')
                console.log('?? Código de error:', errorCode)
                
                if (shouldReconnect) {
                    console.log('?? Reintentando conexión en 5 segundos...')
                    setTimeout(() => connectToWhatsApp(), 5000)
                } else {
                    console.log('?? No se reintentará la conexión (logged out)')
                }
            } else if (connection === 'open') {
                connectionStatus = 'Conectado'
                qrCodeData = null
                
                try {
                    if (sock.user && sock.user.id) {
                        deviceNumber = sock.user.id.split(':')[0].replace(/[^0-9]/g, '')
                    }
                } catch (e) {
                    console.log('?? No se pudo obtener el número del dispositivo')
                }
                
                console.log('? ¡WHATSAPP CONECTADO CORRECTAMENTE!')
                if (deviceNumber) {
                    console.log('?? Número conectado: +' + deviceNumber)
                }
            }
        })

        // Manejar mensajes recibidos
        sock.ev.on('messages.upsert', (m) => {
            const messages = m.messages || []
            for (const msg of messages) {
                if (!msg.key.fromMe && msg.message) {
                    const from = msg.key.remoteJid
                    let messageText = ''
                    
                    if (msg.message.conversation) {
                        messageText = msg.message.conversation
                    } else if (msg.message.extendedTextMessage) {
                        messageText = msg.message.extendedTextMessage.text
                    }
                    
                    if (messageText) {
                        console.log(`?? Mensaje recibido de ${from}: ${messageText}`)
                    }
                }
            }
        })

    } catch (error) {
        console.error('? Error en connectToWhatsApp:', error)
        connectionStatus = 'Error: ' + error.message
        setTimeout(() => connectToWhatsApp(), 10000)
    }
}

// Iniciar servidor web
app.listen(3000, '0.0.0.0', () => {
    console.log('?? Servidor web iniciado en: http://localhost:3000')
    console.log('?? Versión simplificada para solucionar problemas de conexión')
    console.log('? Iniciando conexión a WhatsApp...')
})

// Iniciar conexión
connectToWhatsApp()