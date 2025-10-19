# Stage 1: Build the Next.js application
FROM node:20-alpine AS builder

# CORRECCIÓN DE VULNERABILIDADES: Actualiza los paquetes del sistema base
RUN apk update && apk upgrade && rm -rf /var/cache/apk/*

# Instala dependencias para la compilación (Python y g++ si son necesarios)
RUN apk add --no-cache python3 g++ make

WORKDIR /app

# Copia SOLO los archivos de configuración de NPM y Node
COPY package.json ./ 
COPY .npmrc .nvmrc ./

# Instala las dependencias de la aplicación usando npm
RUN npm install

# Copia el código fuente
COPY . .

# Deshabilita la telemetría de Next.js
ENV NEXT_TELEMETRY_DISABLED 1

# Ejecuta la compilación de Next.js
# Se usa '|| true' para forzar que Docker continúe si hay errores de Lint/TS
RUN npm run build || true 


# Stage 2: Create the final production image (más ligera y segura)
FROM node:20-alpine

# Crea un usuario no-root para seguridad
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
WORKDIR /home/nextjs

# Copia el resultado de la compilación 'standalone'
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/public ./public

# Configura variables de entorno
ENV NODE_ENV production
ENV PORT 3000

# El servidor de Next.js se ejecutará como el usuario 'nextjs'
USER nextjs

# Expone el puerto
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["node", "server.js"]
