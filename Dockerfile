FROM node:16.14.2-alpine3.15

WORKDIR /usr/src/app

COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm ci
RUN npm i -g pm2 ts-node-dev typescript@4.5.2
CMD  ts-node-dev --project ./tsconfig.json --respawn ./src/index.ts
EXPOSE 3000
