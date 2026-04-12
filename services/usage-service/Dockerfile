# Build context = services/ root (set in docker-compose)
# usage-service
FROM node:20-alpine
RUN apk add --no-cache wget
WORKDIR /app
COPY usage-service/package.json ./
RUN npm install --production
COPY db/ ./db/
COPY usage-service/ ./
EXPOSE 8083
CMD ["node", "index.js"]
