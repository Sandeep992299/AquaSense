# Build context = services/ root (set in docker-compose)
# alert-service
FROM node:20-alpine
RUN apk add --no-cache wget
WORKDIR /app
COPY alert-service/package.json ./
RUN npm install --production
COPY db/ ./db/
COPY alert-service/ ./
EXPOSE 8084
CMD ["node", "index.js"]
