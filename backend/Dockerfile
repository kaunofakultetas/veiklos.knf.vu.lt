FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

COPY app/package*.json ./
RUN npm ci --omit=dev

COPY app .

EXPOSE 4000

CMD ["node", "src/index.js"]
