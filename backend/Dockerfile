FROM node:24.16.0-alpine

WORKDIR /app

# Copy application source code
COPY app /app

# Install dependencies
RUN npm install --omit=dev

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# Liveness probe against the unauthenticated health route
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "src/index.js"]