# Dockerfile for PAI Notifier
FROM node:20-alpine

# Install Chromium and necessary dependencies for Puppeteer
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY src/ ./src/

# Create data directory for persistence
RUN mkdir -p /app/data

# Set environment variables
ENV NODE_ENV=production

# Run the bot
CMD ["node", "src/index.js"]
