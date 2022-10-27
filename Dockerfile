FROM node:10-alpine

WORKDIR /usr/src/app

COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
RUN apk add --update alpine-sdk
RUN apk add git
RUN npm ci
RUN npm i -g pm2 ts-node-dev
CMD  ts-node-dev --project ./tsconfig.json --respawn ./src/index.ts
EXPOSE 3000
