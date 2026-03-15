# Use a lightweight Node.js API image based on Alpine Linux
FROM node:22-alpine AS builder

# Set the working directory directly in the container
WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install dependencies, including devDependencies like prisma during build
RUN npm install

# Copy everything else from the project directory
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Create production image
FROM node:22-alpine AS runner

WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Copy built node_modules, Prisma client and project files from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
# Copy .env file if it exists, otherwise environment variables should be injected by docker-compose
COPY .env* ./ 

# Create the uploads directory required by the app and adjust permissions
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

# Expose the port the app runs on
EXPOSE 3200

# Switch to non-root user for security
USER node

# Start the application 
CMD ["npm", "start"]
