FROM node:25-alpine AS base

# Install pnpm (via npm; alpine image lacks corepack)
RUN npm i -g pnpm@10.20.0

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install all dependencies (including dev for build)
RUN pnpm install --no-frozen-lockfile

# Copy source and config
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

# Build TypeScript
RUN pnpm run build

# Production stage
FROM node:25-alpine

# Install pnpm (via npm; alpine image lacks corepack)
# bash
RUN npm i -g pnpm@10.20.0

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install production dependencies only
RUN pnpm install --no-frozen-lockfile --prod

# Copy built artifacts from build stage
COPY --from=base /app/dist ./dist
COPY --from=base /app/public ./public

# Copy template file (needed at runtime)
COPY src/server/template.html ./dist/server/template.html

EXPOSE 3000
CMD ["node", "dist/server.js"]
