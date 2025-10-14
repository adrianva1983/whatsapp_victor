@echo off
REM Script de inicio para WhatsApp Multi-Device con Docker en Windows

echo ?? Iniciando WhatsApp Multi-Device con Docker...

REM Crear directorios necesarios
echo ?? Creando directorios...
if not exist sessions mkdir sessions
if not exist logs mkdir logs
if not exist multimedia mkdir multimedia

REM Construir y levantar servicios
echo ?? Construyendo contenedores...
docker-compose build

echo ?? Iniciando servicios...
docker-compose up -d

REM Esperar a que los servicios estén listos
echo ? Esperando a que los servicios estén listos...
timeout /t 10 /nobreak > nul

REM Mostrar estado
echo ?? Estado de los servicios:
docker-compose ps

echo.
echo ? ¡Servicios iniciados!
echo.
echo ?? URLs disponibles:
echo    - WhatsApp App:  http://localhost:3000
echo    - Dashboard:     http://localhost:3001
echo.
echo ?? Comandos útiles:
echo    - Ver logs:      docker-compose logs -f
echo    - Parar todo:    docker-compose down
echo    - Reiniciar:     docker-compose restart
echo.
pause