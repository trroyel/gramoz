# ── Multi-Stage Production Dockerfile for Gramoz Frontend (Next.js 16) ──

# Stage 1: Dependencies & Build
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies needed for build tools
RUN apk add --no-cache libc6-compat

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# Set environment for build time
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache dumb-init curl

# Create non-root user
RUN addgroup -g 1001 -S nextjs && \
    adduser -u 1001 -S nextjs -G nextjs

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.ts ./next.config.ts

RUN chown -R nextjs:nextjs /app

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/ || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start", "--", "-p", "3000"]
