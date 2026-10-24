# Build context is the repository root, because npm workspaces resolve from there.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --workspace api
COPY api api
RUN npm run build --workspace api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace api && npm cache clean --force
COPY --from=build /app/api/dist api/dist
COPY api/migrations api/migrations
COPY api/openapi.yaml api/openapi.yaml
WORKDIR /app/api
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
