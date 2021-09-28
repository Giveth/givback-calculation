FROM node:10-alpine

WORKDIR /usr/src/app

COPY package*.json ./
COPY src ./src
RUN apk add --update alpine-sdk
RUN apk add git
RUN npm ci
RUN npm i -g pm2
CMD  pm2-runtime start ./src/index.js
EXPOSE 3000
