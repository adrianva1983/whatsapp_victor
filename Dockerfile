# Dockerfile para WhatsApp Multi-Device
FROM node:20-alpine

# Instalar dependencias del sistema
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Configurar variables de entorno para Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Crear directorio de trabajo
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias
RUN npm ci --only=production && npm cache clean --force

# Copiar código fuente
COPY . .

# Crear directorios necesarios
RUN mkdir -p sessions logs multimedia

# Crear usuario no root por seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S whatsapp -u 1001 -G nodejs

# Cambiar propietario de archivos
RUN chown -R whatsapp:nodejs /app

# Cambiar a usuario no root
USER whatsapp

# Exponer puertos
EXPOSE 3000 3001

# Script de inicio por defecto
CMD ["node", "simple-connect.js"]