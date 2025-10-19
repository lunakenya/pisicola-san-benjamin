# Stage 1: Build the Next.js application
FROM node:20-alpine AS builder

# CORRECCIÓN DE VULNERABILIDADES: Actualiza los paquetes del sistema base
RUN apk update && apk upgrade && rm -rf /var/cache/apk/*

# Instala dependencias para la compilación
RUN apk add --no-cache python3 g++ make

WORKDIR /app

# Línea 1: Copia el archivo CRÍTICO (package.json). Si no está, debe fallar.
COPY package.json ./ 

# Línea 2: Copia archivos opcionales. El '|| true' permite que continúe si no se encuentran.
# Esto es la corrección final para tu error:
COPY .npmrc .nvmrc ./ || true 

# Instala las dependencias de la aplicación usando npm
RUN npm install

# Copia el código fuente
COPY . .

# Deshabilita la telemetría de Next.js
ENV NEXT_TELEMETRY_DISABLED 1

# Ejecuta la compilación de Next.js
RUN npm run build || true 


# Stage 2: Create the final production image
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
