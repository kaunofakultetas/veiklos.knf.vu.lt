FROM node:24.16.0-alpine

WORKDIR /app

# Copy application source code
COPY app /app

# Install dependencies
RUN npm install --omit=dev

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/index.js"]