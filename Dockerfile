# Dockerfile for PAI Notifier
FROM node:20-alpine

# Install Python and instaloader for Instagram monitoring
RUN apk add --no-cache python3 py3-pip && \
    pip3 install --break-system-packages instaloader

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
