# ?? WhatsApp Multi-Device con Docker

## Instalación y Configuración

### Prerrequisitos
- **Docker Desktop** instalado en Windows
- **Docker Compose** (incluido con Docker Desktop)

### ?? Inicio Rápido

1. **Clonar o descargar** este proyecto
2. **Abrir terminal** en la carpeta del proyecto
3. **Ejecutar el script de inicio:**

```bash
# En Windows (PowerShell/CMD)
start.bat

# En Git Bash/WSL
./start.sh

# O manualmente
docker-compose up -d
```

### ?? URLs del Sistema

- **WhatsApp App**: http://localhost:3000
- **Dashboard**: http://localhost:3001
- **MongoDB**: puerto 27017 (interno)

### ?? Comandos Docker Útiles

```bash
# Ver estado de contenedores
docker-compose ps

# Ver logs en tiempo real
docker-compose logs -f

# Ver logs de un servicio específico
docker-compose logs -f whatsapp-app
docker-compose logs -f whatsapp-dashboard

# Parar todos los servicios
docker-compose down

# Parar y eliminar volúmenes (CUIDADO: borra datos)
docker-compose down -v

# Reiniciar servicios
docker-compose restart

# Reconstruir contenedores
docker-compose build --no-cache
docker-compose up -d

# Entrar a un contenedor
docker exec -it whatsapp_app sh
docker exec -it whatsapp_mongodb mongosh
```

### ?? Estructura de Volúmenes

```
./sessions/     ? Sesiones WhatsApp (persistente)
./logs/         ? Logs de aplicación (persistente)  
./multimedia/   ? Archivos multimedia (persistente)
mongodb_data/   ? Datos MongoDB (volumen Docker)
```

### ??? Configuración Avanzada

#### Variables de Entorno
Crea un archivo `.env` para personalizar:

```env
# Puertos
WHATSAPP_PORT=3000
DASHBOARD_PORT=3001
MONGODB_PORT=27017

# MongoDB
MONGODB_URL=mongodb://mongodb:27017/whatsapp_dashboard

# Aplicación
NODE_ENV=production
```

#### Escalado
Para múltiples instancias de la aplicación:

```bash
docker-compose up -d --scale whatsapp-app=3
```

### ?? Troubleshooting

#### Problemas Comunes

1. **Puerto ocupado**:
```bash
# Cambiar puertos en docker-compose.yml
ports:
  - "3005:3000"  # Usar puerto 3005 en lugar de 3000
```

2. **Problemas de permisos**:
```bash
# En Linux/WSL
sudo chown -R $USER:$USER ./sessions ./logs ./multimedia
```

3. **Contenedor no inicia**:
```bash
# Ver logs detallados
docker-compose logs whatsapp-app
```

4. **Limpiar todo y empezar de nuevo**:
```bash
docker-compose down -v
docker system prune -a
docker-compose up -d
```

### ?? Monitoreo

#### Health Checks
Los contenedores incluyen health checks automáticos:

```bash
# Ver estado de salud
docker ps --format "table {{.Names}}\t{{.Status}}"
```

#### Logs Centralizados
```bash
# Logs de todos los servicios
docker-compose logs -f --tail=50

# Filtrar por servicio
docker-compose logs -f whatsapp-app | grep "ERROR"
```

### ?? Seguridad

#### Configuración de Producción
Para uso en producción, modifica `docker-compose.yml`:

```yaml
# Añadir variables de entorno seguras
environment:
  - NODE_ENV=production
  - API_SECRET=tu_secreto_aqui
  
# Restringir puertos (solo interno)
# ports:
#   - "3000:3000"  # Comentar para acceso solo interno
```

#### Backup de Datos
```bash
# Backup de MongoDB
docker exec whatsapp_mongodb mongodump --out /backup

# Backup de sesiones
tar -czf backup_sessions.tar.gz ./sessions/
```

### ?? Despliegue en Servidor

Para desplegar en servidor remoto:

1. **Copiar archivos** al servidor
2. **Modificar puertos** en docker-compose.yml si es necesario
3. **Configurar firewall** para puertos 3000, 3001
4. **Usar proxy reverso** (nginx) para SSL

Ejemplo nginx:
```nginx
server {
    listen 80;
    server_name tu-dominio.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### ?? Escalabilidad

Para manejar más dispositivos:

1. **Aumentar recursos** del contenedor
2. **Escalar horizontalmente**:
```bash
docker-compose up -d --scale whatsapp-app=5
```
3. **Usar load balancer** (nginx, traefik)
4. **MongoDB replica set** para alta disponibilidad