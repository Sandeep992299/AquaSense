# Build context = services/ root (set in docker-compose)
# user-service
FROM node:20-alpine
RUN apk add --no-cache wget
WORKDIR /app
COPY user-service/package.json ./
RUN npm install --production
COPY db/ ./db/
COPY user-service/ ./
EXPOSE 8081
CMD ["node", "index.js"]
