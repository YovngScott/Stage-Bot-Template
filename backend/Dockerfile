# Imagen del backend del bot de WhatsApp para desplegar en Fly.io.
# El bot se ejecuta con tsx directamente (sin paso de compilación).
# Supabase Realtime requiere WebSocket nativo, disponible en Node 22+.
# Node 20 provoca un crash loop en Fly antes de que Express pueda iniciar.
FROM node:22-slim

WORKDIR /app

# Instala solo dependencias de producción (tsx está en dependencies, no en
# devDependencies, así que basta para arrancar).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
# Fly enruta el tráfico al puerto interno definido en fly.toml (8080).
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start"]
