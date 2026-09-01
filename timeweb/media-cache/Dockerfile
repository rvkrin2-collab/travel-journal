FROM node:24-alpine

WORKDIR /app
COPY server.mjs ./server.mjs

ENV NODE_ENV=production \
    PORT=8080 \
    CACHE_ROOT=/cache

RUN mkdir -p /cache && chown -R node:node /app /cache
USER node

EXPOSE 8080
CMD ["node", "server.mjs"]
