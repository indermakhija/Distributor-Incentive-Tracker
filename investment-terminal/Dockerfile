FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
CMD ["node", "--no-warnings=ExperimentalWarning", "server/index.js"]
