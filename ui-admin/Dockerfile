# Stage 1: Build
FROM node:22-bookworm AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json ./
# If you had a lockfile it would go here, but since it's fresh scaffolding we might just install
RUN pnpm install

# Copy source
COPY . .

# Build-time config for platform/tenant mode
ARG VITE_ADMIN_MODE=platform
ARG VITE_ADMIN_API_BASE=/api/v1/platform
ARG VITE_ADMIN_STORAGE_KEY=openclaw_platform_admin_token
ENV VITE_ADMIN_MODE=$VITE_ADMIN_MODE
ENV VITE_ADMIN_API_BASE=$VITE_ADMIN_API_BASE
ENV VITE_ADMIN_STORAGE_KEY=$VITE_ADMIN_STORAGE_KEY

# Build
RUN pnpm build

# Stage 2: Serve
FROM nginx:alpine

# Copy build artifacts
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
