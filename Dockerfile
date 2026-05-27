FROM node:20-slim

WORKDIR /app

# Install build tools required for better-sqlite3 native module
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy all source files
COPY . .

# Build the frontend (vite) and backend (esbuild)
RUN npm run build

# Cloud Run uses PORT env variable (default 8080)
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/server.cjs"]
