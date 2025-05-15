# Stage 1: Build the application
FROM node:23.11.1-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Create the production image
FROM node:23.11.1-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm install --production
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]