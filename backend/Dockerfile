FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN ./node_modules/.bin/tsc --noEmit false --outDir build --rootDir . \
    && find src -type f ! -name '*.ts' -exec cp --parents {} build/ \;

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS runtime
ENV NODE_ENV=production PORT=8080 DATABASE_PATH=/var/lib/talkmato/talkmato.sqlite
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force \
    && mkdir -p /var/lib/talkmato && chown node:node /var/lib/talkmato
COPY --from=build /app/build/src ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
