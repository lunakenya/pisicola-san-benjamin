# ----------------------------------------------------------------------
# Stage 1: Build the Next.js application (Usando Alpine para ligereza)
FROM node:18-alpine AS builder

# 1. DECLARACIÓN DE ARGUMENTOS DE CONSTRUCCIÓN
# Estos ARGUMENTOS deben ser pasados durante 'docker build'.
ARG DATABASE_URL
ARG JWT_SECRET

# CORRECCIÓN DE VULNERABILIDADES: Ya usa apk porque la base es Alpine
RUN apk update && apk upgrade && rm -rf /var/cache/apk/*

# Instala dependencias para la compilación (necesarias para 'bcryptjs', 'pg' y otros módulos nativos)
RUN apk add --no-cache python3 g++ make

WORKDIR /app
COPY package.json ./

# Instala las dependencias de la aplicación usando npm
RUN npm install

# Copia el código fuente (incluyendo el archivo route.ts corregido y next.config.ts)
COPY . .

# 2. INYECCIÓN DE VARIABLES DE ENTORNO PARA LA COMPILACIÓN
# Las variables se configuran como ENV para que Next.js las vea durante 'npm run build'.
ENV NEXT_TELEMETRY_DISABLED 1
ENV DATABASE_URL=$DATABASE_URL
ENV JWT_SECRET=$JWT_SECRET

# Ejecuta la compilación de Next.js
# CORRECCIÓN: Eliminamos '|| true'. La compilación debe ser exitosa para que el paso continúe.
RUN npm run build

# ----------------------------------------------------------------------
# Stage 2: Create the final production image (Usando Alpine)
FROM node:18-alpine

# Crea un usuario no-root para seguridad
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
WORKDIR /home/nextjs

# Copia el resultado de la compilación 'standalone'
COPY --from=builder /app/.next/standalone ./
# NOTA: En modo standalone, next.js solo copia las dependencias requeridas al standalone folder.
# Copiar /app/node_modules puede no ser necesario o puede introducir módulos extra.
# Usaré la práctica de standalone:
# COPY --from=builder /app/node_modules ./node_modules
# COPY --from=builder /app/package.json ./package.json

COPY --from=builder /app/public ./public

# Configura variables de entorno para EJECUCIÓN
ENV NODE_ENV production
ENV PORT 3000

# El servidor de Next.js se ejecutará como el usuario 'nextjs'
USER nextjs

# Expone el puerto
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["node", "server.js"]
