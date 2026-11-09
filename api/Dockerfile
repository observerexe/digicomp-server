# Build context: the repository root (docker-compose.yml: context ".").

# 1. Web app (React, Vite): web/dist
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY docs/design/tokens.json /src/docs/design/tokens.json
COPY web/ ./
RUN npm run build

# 2. API (NestJS): api/dist
FROM node:22-alpine AS build
WORKDIR /app
COPY api/package*.json ./
RUN npm ci
COPY api/ .
RUN npm run build

# 3. Runtime: API serves the web app from the same origin.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV WEB_DIST=/app/web
COPY api/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=web /src/web/dist ./web
CMD ["node", "dist/main"]
