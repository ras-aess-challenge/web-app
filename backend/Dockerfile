FROM node:22-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund
COPY backend/src ./backend/src
COPY shared ./shared
WORKDIR /app/backend
CMD ["node", "src/index.js"]
