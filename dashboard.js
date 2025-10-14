const express = require('express')
const { MongoClient } = require('mongodb')
const fs = require('fs')
const path = require('path')

const app = express()
app.use(express.json())

// Configuración MongoDB
const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017'
const dbName = 'whatsapp_dashboard'
let db

// Conectar a MongoDB
async function connectDB() {
    try {
        const client = new MongoClient(mongoUrl)
        await client.connect()
        db = client.db(dbName)
        console.log('✅ Conectado a MongoDB')
        
        // Crear índices
        await db.collection('devices').createIndex({ deviceId: 1 }, { unique: true })
        await db.collection('messages').createIndex({ timestamp: -1 })
        await db.collection('events').createIndex({ timestamp: -1 })
    } catch (error) {
        console.error('❌ Error conectando a MongoDB:', error)
    }
}

// Funciones para interactuar con la base de datos
async function saveDevice(deviceData) {
    try {
        await db.collection('devices').updateOne(
            { deviceId: deviceData.deviceId },
            { $set: { ...deviceData, lastUpdate: new Date() } },
            { upsert: true }
        )
    } catch (error) {
        console.error('Error guardando dispositivo:', error)
    }
}

async function saveMessage(messageData) {
    try {
        await db.collection('messages').insertOne({
            ...messageData,
            timestamp: new Date()
        })
    } catch (error) {
        console.error('Error guardando mensaje:', error)
    }
}

async function saveEvent(eventData) {
    try {
        await db.collection('events').insertOne({
            ...eventData,
            timestamp: new Date()
        })
    } catch (error) {
        console.error('Error guardando evento:', error)
    }
}

// Endpoint para recibir webhooks de conexiones
app.post('/webhook/connection', async (req, res) => {
    const { deviceId, status, phoneNumber, error } = req.body
    
    const deviceData = {
        deviceId,
        status,
        phoneNumber,
        error: error || null
    }
    
    await saveDevice(deviceData)
    await saveEvent({
        type: 'CONNECTION_UPDATE',
        deviceId,
        data: deviceData
    })
    
    console.log(`📱 Dispositivo ${deviceId}: ${status}`)
    res.json({ success: true })
})

// Endpoint para recibir webhooks de mensajes
app.post('/webhook/message', async (req, res) => {
    const { deviceId, from, to, message, messageType } = req.body
    
    const messageData = {
        deviceId,
        from,
        to,
        message,
        messageType: messageType || 'text',
        direction: 'received'
    }
    
    await saveMessage(messageData)
    await saveEvent({
        type: 'MESSAGE_RECEIVED',
        deviceId,
        data: messageData
    })
    
    console.log(`📨 Mensaje de ${from} para ${to}: ${message}`)
    res.json({ success: true })
})

// Dashboard principal
app.get('/', async (req, res) => {
    try {
        const devices = await db.collection('devices').find({}).sort({ lastUpdate: -1 }).toArray()
        const recentMessages = await db.collection('messages').find({}).sort({ timestamp: -1 }).limit(10).toArray()
        const recentEvents = await db.collection('events').find({}).sort({ timestamp: -1 }).limit(20).toArray()
        
        const connectedCount = devices.filter(d => d.status === 'connected').length
        const totalMessages = await db.collection('messages').countDocuments()
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>WhatsApp Dashboard</title>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { 
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                        margin: 0; 
                        padding: 20px; 
                        background: #f8f9fa; 
                    }
                    .header { 
                        background: linear-gradient(135deg, #f7913eff 0%, rgba(247, 145, 62, 1) 100%);
                        color: white; 
                        padding: 30px; 
                        border-radius: 15px; 
                        margin-bottom: 30px;
                        text-align: center;
                    }
                    .stats { 
                        display: grid; 
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
                        gap: 20px; 
                        margin-bottom: 30px; 
                    }
                    .stat-card { 
                        background: white; 
                        padding: 25px; 
                        border-radius: 12px; 
                        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                        text-align: center;
                    }
                    .stat-number { 
                        font-size: 2.5em; 
                        font-weight: bold; 
                        color: #4299e1; 
                        margin: 10px 0; 
                    }
                    .content { 
                        display: grid; 
                        grid-template-columns: 1fr 1fr; 
                        gap: 30px; 
                    }
                    .section { 
                        background: white; 
                        border-radius: 15px; 
                        padding: 25px; 
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                    }
                    .section h3 { 
                        margin-top: 0; 
                        color: #2d3748;
                        border-bottom: 2px solid #e2e8f0;
                        padding-bottom: 10px;
                    }
                    .device-list, .message-list, .event-list { 
                        max-height: 400px; 
                        overflow-y: auto; 
                    }
                    .device-item, .message-item, .event-item { 
                        padding: 12px; 
                        border-bottom: 1px solid #e2e8f0; 
                        display: flex; 
                        justify-content: space-between;
                        align-items: center;
                    }
                    .device-item:last-child, .message-item:last-child, .event-item:last-child { 
                        border-bottom: none; 
                    }
                    .status { 
                        padding: 4px 12px; 
                        border-radius: 20px; 
                        font-size: 0.85em; 
                        font-weight: bold;
                    }
                    .connected { background: #c6f6d5; color: #22543d; }
                    .disconnected { background: #fed7d7; color: #742a2a; }
                    .waiting { background: #fefcbf; color: #744210; }
                    .timestamp { 
                        font-size: 0.8em; 
                        color: #718096; 
                    }
                    .message-content { 
                        max-width: 300px; 
                        overflow: hidden; 
                        text-overflow: ellipsis; 
                        white-space: nowrap;
                    }
                    .api-section {
                        grid-column: 1 / -1;
                        background: #edf2f7;
                        border: 2px dashed #cbd5e0;
                        text-align: center;
                        padding: 30px;
                    }
                    .api-code {
                        background: #2d3748;
                        color: #e2e8f0;
                        padding: 15px;
                        border-radius: 8px;
                        font-family: 'Courier New', monospace;
                        margin: 15px 0;
                        text-align: left;
                        white-space: pre-wrap;
                        overflow-x: auto;
                    }
                    @media (max-width: 768px) {
                        .content { grid-template-columns: 1fr; }
                        .stats { grid-template-columns: 1fr; }
                    }
                </style>
                <script>
                    setInterval(() => location.reload(), 15000); // Auto-refresh cada 15 segundos
                </script>
            </head>
            <body>
                <div class="header">
                    <h1>📊 WhatsApp Dashboard</h1>
                    <p>Sistema de monitoreo y gestión de dispositivos WhatsApp</p>
                </div>
                
                <div class="stats">
                    <div class="stat-card">
                        <div>📱 Dispositivos Conectados</div>
                        <div class="stat-number">${connectedCount}</div>
                        <div>de ${devices.length} total</div>
                    </div>
                    <div class="stat-card">
                        <div>💬 Mensajes Procesados</div>
                        <div class="stat-number">${totalMessages}</div>
                        <div>en total</div>
                    </div>
                    <div class="stat-card">
                        <div>🚀 Estado del Sistema</div>
                        <div class="stat-number">✅</div>
                        <div>Activo</div>
                    </div>
                </div>
                
                <div class="content">
                    <div class="section">
                        <h3>📱 Dispositivos</h3>
                        <div class="device-list">
                            ${devices.length === 0 ? '<p>No hay dispositivos conectados</p>' : 
                                devices.map(device => `
                                    <div class="device-item">
                                        <div>
                                            <strong>${device.phoneNumber || device.deviceId}</strong><br>
                                            <small>${device.deviceId}</small>
                                        </div>
                                        <div>
                                            <div class="status ${device.status}">${device.status}</div>
                                            <div class="timestamp">${new Date(device.lastUpdate).toLocaleString()}</div>
                                        </div>
                                    </div>
                                `).join('')
                            }
                        </div>
                    </div>
                    
                    <div class="section">
                        <h3>💬 Mensajes Recientes</h3>
                        <div class="message-list">
                            ${recentMessages.length === 0 ? '<p>No hay mensajes recientes</p>' : 
                                recentMessages.map(msg => `
                                    <div class="message-item">
                                        <div>
                                            <strong>${msg.from} → ${msg.to}</strong><br>
                                            <div class="message-content">${msg.message}</div>
                                        </div>
                                        <div>
                                            <div class="timestamp">${new Date(msg.timestamp).toLocaleString()}</div>
                                        </div>
                                    </div>
                                `).join('')
                            }
                        </div>
                    </div>
                    
                    <div class="section">
                        <h3>📋 Eventos del Sistema</h3>
                        <div class="event-list">
                            ${recentEvents.length === 0 ? '<p>No hay eventos recientes</p>' : 
                                recentEvents.map(event => `
                                    <div class="event-item">
                                        <div>
                                            <strong>${event.type}</strong><br>
                                            <small>${event.deviceId || 'Sistema'}</small>
                                        </div>
                                        <div class="timestamp">${new Date(event.timestamp).toLocaleString()}</div>
                                    </div>
                                `).join('')
                            }
                        </div>
                    </div>
                    
                    <div class="api-section">
                        <h3>🔌 API para Enviar Mensajes</h3>
                        <p>Usa esta API para enviar mensajes desde tus aplicaciones:</p>
                        
                        <h4>Endpoint:</h4>
                        <div class="api-code">POST http://82.223.205.101:3000/api/send-message

Contenido: application/json

{
  "telefono_origen": "34123456789",
  "telefono_destino": "34987654321", 
  "mensaje": "Hola, este es un mensaje de prueba"
}</div>
                        
                        <h4>Ejemplo con cURL:</h4>
                        <div class="api-code">curl -X POST http://82.223.205.101:3000/api/send-message \\
  -H "Content-Type: application/json" \\
  -d '{
    "telefono_origen": "34123456789",
    "telefono_destino": "34987654321",
    "mensaje": "Hola desde la API"
  }'</div>
                    </div>
                </div>
            </body>
            </html>
        `)
    } catch (error) {
        console.error('Error en dashboard:', error)
        res.status(500).send('Error cargando dashboard')
    }
})

// Inicializar servidor
async function init() {
    await connectDB()
    
    app.listen(3001, '0.0.0.0', () => {
        console.log('📊 WhatsApp Dashboard iniciado en: http://0.0.0.0:3001')
    })
}

init()
