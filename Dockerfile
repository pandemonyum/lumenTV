# LumenTV metadata/catalog server. It never proxies or transcodes video streams.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY apps ./apps
COPY packages ./packages
COPY tools ./tools
RUN npm install --no-audit --no-fund
RUN npm run build:web

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    LUMENTV_HOST=0.0.0.0 \
    LUMENTV_PORT=8787 \
    LUMENTV_DATABASE=/app/data/lumentv.sqlite \
    LUMENTV_IMAGE_DIR=/app/data/images \
    LUMENTV_PUBLIC_BASE_URL=http://localhost:8787
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/client/dist ./apps/client/dist
COPY --from=build /app/packages/core ./packages/core
RUN mkdir -p /app/data/images
VOLUME ["/app/data"]
EXPOSE 8787
CMD ["node", "apps/api/src/server.mjs"]
