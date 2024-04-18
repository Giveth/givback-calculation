FROM node:20.11.0-alpine3.18

WORKDIR /usr/src/app

COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
COPY abi ./abi
# Install Python and other dependencies required by node-gyp
RUN apk add --no-cache python3 make g++

RUN npm ci
RUN npm i -g pm2 ts-node-dev typescript@4.5.2
CMD  ts-node-dev --project ./tsconfig.json --respawn ./src/index.ts
EXPOSE 3000
