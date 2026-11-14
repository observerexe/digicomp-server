# Build context: the repository root (docker-compose.yml: context ".").
# shared/ (the editor schema) is source of both packages: it sits next to them as in the repo.

# 1. Web app (React, Vite): web/dist
FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY docs/design/tokens.json /src/docs/design/tokens.json
COPY shared/ /src/shared/
COPY web/ ./
RUN npm run build

# 2. API (NestJS): api/dist (dist/api/src and dist/shared)
FROM node:24-alpine AS build
WORKDIR /src/api
COPY api/package*.json ./
RUN npm ci
COPY shared/ /src/shared/
COPY api/ .
RUN npm run build

# 3. Runtime: API serves the web app from the same origin.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV WEB_DIST=/app/web
COPY api/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /src/api/dist ./dist
COPY --from=web /src/web/dist ./web
CMD ["node", "dist/api/src/main"]
