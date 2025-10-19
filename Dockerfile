# ----------------------------------------------------------------------
# Stage 1: Build the Next.js application (Usando Alpine para ligereza)
# ----------------------------------------------------------------------
FROM node:18-alpine AS builder

# Instala dependencias del sistema necesarias para compilar librerías nativas.
# Esto reemplaza tu RUN apk add anterior.
RUN apk update && \
    apk add --no-cache python3 g++ make git openssl

# Crea el directorio de trabajo
WORKDIR /app

# Copia SOLO los archivos de configuración de dependencias para aprovechar el cache
COPY package.json ./
COPY package-lock.json ./

# Instala las dependencias. Usamos --unsafe-perm para evitar
# problemas de permisos durante la instalación de paquetes nativos.
RUN npm install --unsafe-perm

# Copia el código fuente restante de la aplicación
COPY . .

# Deshabilita la telemetría de Next.js
ENV NEXT_TELEMETRY_DISABLED 1

# Ejecuta la compilación de Next.js
# Esto genera el resultado optimizado en el directorio .next/standalone
RUN npm run build


# ----------------------------------------------------------------------
# Stage 2: Create the final production image (También en Alpine)
# ----------------------------------------------------------------------
FROM node:18-alpine

# Configuración de seguridad: Crea un usuario no-root
RUN addgroup --system --gid 1001 nodejs
# adduser -D es el comando para crear usuarios ligeros en Alpine
RUN adduser -D --system --uid 1001 nextjs

WORKDIR /home/nextjs

# Copia los archivos de la etapa 'builder'
# Se utiliza --chown para asegurar que el nuevo usuario 'nextjs' sea el propietario
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
# Copia la salida del modo standalone
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Copia los assets estáticos
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Copia los archivos estáticos generados
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Configura variables de entorno
ENV NODE_ENV production
ENV PORT 3000

# El servidor de Next.js se ejecutará como el usuario 'nextjs'
USER nextjs

# Expone el puerto por el que escucha la aplicación
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["node", "server.js"]
