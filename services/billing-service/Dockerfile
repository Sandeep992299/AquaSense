# Build context = services/ root (set in docker-compose)
# billing-service
FROM node:20-alpine
RUN apk add --no-cache wget
WORKDIR /app
COPY billing-service/package.json ./
RUN npm install --production
COPY db/ ./db/
COPY billing-service/ ./
EXPOSE 8082
CMD ["node", "index.js"]
