# Production image
FROM node:20-alpine

WORKDIR /app

# Copy shared library
COPY lib /app/lib
# Copy scout service
COPY services/scout /app/services/scout

WORKDIR /app/services/scout
RUN npm install

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV SCOUT_HEADLESS=true
ENV SCOUT_MODE=connect
# "chromium" is the Docker Compose sidecar service name — override for other deploy targets
ENV SCOUT_CONNECT_URL=http://chromium:9222

EXPOSE 8091

CMD ["npx", "tsx", "src/index.ts"]
