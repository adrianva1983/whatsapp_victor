const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const QRCode = require('qrcode')

const app = express()
let qrCodeData = null
let connectionStatus = 'Desconectado'

// Servir página web con QR
app.get('/', async (req, res) => {
    let qrImage = ''
    if (qrCodeData) {
        qrImage = await QRCode.toDataURL(qrCodeData)
    }
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp QR Code</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: Arial; text-align: center; padding: 20px; }
                .status { font-size: 20px; margin: 20px; }
                .qr { margin: 20px; }
                img { max-width: 300px; }
                .connected { color: green; }
                .disconnected { color: red; }
            </style>
            <script>
                setTimeout(() => location.reload(), 5000);
            </script>
        </head>
        <body>
            <h1>WhatsApp Connection</h1>
            <div class="status ${connectionStatus === 'Conectado' ? 'connected' : 'disconnected'}">
                Estado: ${connectionStatus}
            </div>
            ${qrImage ? `
                <div class="qr">
                    <h2>Escanea este QR con WhatsApp:</h2>
                    <img src="${qrImage}" alt="QR Code">
                    <p>Abre WhatsApp → Configuración → Dispositivos conectados → Conectar dispositivo</p>
                </div>
            ` : connectionStatus === 'Conectado' ? '<h2>✅ WhatsApp conectado correctamente!</h2>' : '<h2>Generando QR...</h2>'}
        </body>
        </html>
    `)
})

// Iniciar servidor web
app.listen(3000, '0.0.0.0', () => {
    console.log('🌐 Servidor web iniciado en: http://tu-ip:3000')
    console.log('Abre esa URL en tu navegador para ver el QR')
})

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info')
    
    const sock = makeWASocket({
        auth: state
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        
        if (qr) {
            qrCodeData = qr
            console.log('📱 QR generado - Ve a http://tu-ip:3000 para escanearlo')
        }
        
        if (connection === 'close') {
            connectionStatus = 'Desconectado'
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect)
            
            if (shouldReconnect) {
                connectToWhatsApp()
            }
        } else if (connection === 'open') {
            connectionStatus = 'Conectado'
            qrCodeData = null
            console.log('✅ WhatsApp conectado correctamente!')
        }
    })
}

connectToWhatsApp()
