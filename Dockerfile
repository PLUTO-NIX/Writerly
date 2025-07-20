FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy minimal OAuth app source
COPY src/simple-oauth-minimal.ts ./src/

# Build the application
RUN npx tsc src/simple-oauth-minimal.ts --outDir dist --target es2020 --module commonjs --esModuleInterop --skipLibCheck

# Production stage
FROM node:18-alpine AS production

# Security updates
RUN apk update && apk add --no-cache dumb-init && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S appuser -u 1001 -G nodejs

WORKDIR /app

# Copy built application
COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/package*.json ./

# Switch to non-root user
USER appuser

# Environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').request({port:8080,path:'/health',timeout:2000},(r)=>{process.exit(r.statusCode===200?0:1)}).end()"

# Expose port
EXPOSE 8080

# Start application
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/simple-oauth-minimal.js"]