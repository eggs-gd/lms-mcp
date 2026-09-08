# syntax=docker/dockerfile:1

# --- build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- runtime stage ---------------------------------------------------------- -
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node
EXPOSE 3000/tcp

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${MCP_HTTP_PORT}/health" || exit 1

# In the image the server defaults to the Streamable HTTP transport; clients
# connect to http://<host>:3000/mcp. Override MCP_TRANSPORT=stdio to pipe.
ENTRYPOINT ["node", "dist/index.js"]
