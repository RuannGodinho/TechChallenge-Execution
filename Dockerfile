FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY --chown=node:node . .
USER node
EXPOSE 3001
CMD ["npm", "start"]
