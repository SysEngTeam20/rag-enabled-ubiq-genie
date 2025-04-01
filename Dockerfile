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
COPY requirements.txt ./

# Install Node.js dependencies
RUN npm install

# Set up Python environment
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY Node/ ./
COPY .env ./

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 8000

# Start the application
CMD ["npm", "start", "conversational_agent"] 