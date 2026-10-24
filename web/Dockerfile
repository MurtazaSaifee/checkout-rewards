# Build context is the repository root. The web build reads the contract from
# api/openapi.yaml to generate its API types.

FROM node:24.22.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --workspace web
COPY api/openapi.yaml api/openapi.yaml
COPY web web
RUN npm run build --workspace web

FROM nginx:1.27.5-alpine AS runtime
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
