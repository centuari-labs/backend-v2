# syntax=docker/dockerfile:1.7
# Build stage
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

WORKDIR /app

# Copy package files (.npmrc maps @centuari-labs scope to GitHub Packages;
# auth token is injected via BuildKit secret at install time).
COPY package.json pnpm-lock.yaml .npmrc ./

# Install dependencies (including devDependencies for build)
RUN --mount=type=secret,id=npmrc,dst=/root/.npmrc \
    pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# Verify build produced the entry file (fail fast if not)
RUN test -f /app/dist/src/main.js || (echo "Build failed: dist/src/main.js not found" && exit 1)

# Production stage
FROM node:22-alpine AS production

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

WORKDIR /app

# Copy package files (.npmrc has scope mapping; auth via BuildKit secret)
COPY package.json pnpm-lock.yaml .npmrc ./

# Install production dependencies only
RUN --mount=type=secret,id=npmrc,dst=/root/.npmrc \
    pnpm install --prod --frozen-lockfile

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Verify dist was copied (fail at build time, not runtime)
RUN test -f /app/dist/src/main.js || (echo "COPY failed: dist/src/main.js missing" && exit 1)

# Copy keys (needed for JWT verification)
COPY --from=builder /app/keys ./keys

# Drop root privileges for the runtime container
RUN chown -R node:node /app
USER node

# Expose the application port
EXPOSE 3000

# Run the application
CMD ["node", "dist/src/main.js"]
