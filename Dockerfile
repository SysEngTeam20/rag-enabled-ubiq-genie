# Use Node.js LTS version
FROM node:20-slim

# Install Python and required build tools
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY Node/package*.json ./

# Install Node.js dependencies
RUN npm install

# Set up Python virtual environment
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY Node/ .
COPY .env.template .env.local

# Build TypeScript
RUN npm run build

# Expose ports for the application and WebSocket server
EXPOSE 8000
EXPOSE 5001

# Set environment variables
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1

# Start the application
CMD ["npm", "start", "conversational_agent"] 