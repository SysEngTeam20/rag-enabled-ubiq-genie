# Use Node.js base image
FROM node:20-slim

# Install Python and pip
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY Node/package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy Python requirements
COPY requirements.txt ./
RUN pip3 install -r requirements.txt

# Copy application code
COPY Node/apps/conversational_agent ./apps/conversational_agent
COPY Node/components ./components
COPY Node/services ./services

# Copy environment variables and config
COPY .env.local ./
COPY Node/apps/conversational_agent/config.json ./apps/conversational_agent/

# Expose necessary ports (from config.json)
EXPOSE 8009 8010 8011

# Start the application
CMD ["npm", "start", "conversational_agent"]