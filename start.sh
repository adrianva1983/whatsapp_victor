#!/bin/bash

# Script de inicio para WhatsApp Multi-Device con Docker
# Para Windows, ejecutar: ./start.sh
# Para usar con Git Bash o WSL

echo "?? Iniciando WhatsApp Multi-Device con Docker..."

# Crear directorios necesarios
echo "?? Creando directorios..."
mkdir -p sessions logs multimedia

# Construir y levantar servicios
echo "?? Construyendo contenedores..."
docker-compose build

echo "?? Iniciando servicios..."
docker-compose up -d

# Esperar a que los servicios estén listos
echo "? Esperando a que los servicios estén listos..."
sleep 10

# Mostrar estado
echo "?? Estado de los servicios:"
docker-compose ps

echo ""
echo "? ¡Servicios iniciados!"
echo ""
echo "?? URLs disponibles:"
echo "   - WhatsApp App:  http://localhost:3000"
echo "   - Dashboard:     http://localhost:3001"
echo ""
echo "?? Comandos útiles:"
echo "   - Ver logs:      docker-compose logs -f"
echo "   - Parar todo:    docker-compose down"
echo "   - Reiniciar:     docker-compose restart"
echo ""