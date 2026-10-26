# ── Multi-Stage Production Dockerfile for Gramoz Backend (NestJS 11 + Fastify) ──

# Stage 1: Build & Compile
FROM node:20-alpine AS builder
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package manifests
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code and configs
COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/
COPY drizzle/ ./drizzle/

# Build production bundle
RUN npm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner
WORKDIR /app

# Security: install dumb-init for proper PID 1 signal forwarding (SIGTERM / SIGINT)
RUN apk add --no-cache dumb-init curl

# Create non-privileged service user
RUN addgroup -g 1001 -S gramoz && \
    adduser -u 1001 -S gramoz -G gramoz

ENV NODE_ENV=production
ENV PORT=5000

# Copy manifests and install production-only dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

# Create persistent local uploads directory if fallback is used
RUN mkdir -p /app/uploads && chown -R gramoz:gramoz /app

USER gramoz

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://127.0.0.1:5000/api/v1/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/main"]
