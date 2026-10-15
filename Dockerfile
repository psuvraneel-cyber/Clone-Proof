FROM node:22.19.0-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

CMD ["node", "src/cli.js", "check", "."]
