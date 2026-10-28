# Standalone online room server for DittoApp (one room per deployment).
# The build stage compiles the web client + a self-contained HTTP/WSS server bundle,
# so the runtime image needs no node_modules and no Electron.
#
#   docker build -t dittoapp .
#   docker run --rm -p 8080:8080 -e ROOM_NAME="Escritório online" dittoapp
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && node deploy/build-online.mjs

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/dist ./dist
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/online/server.cjs"]
