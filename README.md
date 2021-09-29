This project has a endpoint to calculate the GIVback rewards.

* The calculation formula  inspired by  https://github.com/Giveth/givbacks-scripts

* This is the notion notes about how we distribute the givback tokens
https://www.notion.so/Spec-GIVbacks-MVP-2d6335964e5b414082e41d7df89f9b3d

* It implemented for resolving this issue https://github.com/Giveth/GIVeconomy/issues/39

## Requirements
Node 10 or higher

## Instalation and run
1. `git clone https://github.com/Giveth/givback-calculation.git`
2. `cd givback-calculation`
3. `npm i`
4. `GIVETHIO_BASE_URL=https://mainnet.serve.giveth.io TRACE_BASE_URL=https://feathers.beta.giveth.io npm start`
5. Browse http://localhost:3000/api-docs


## Deploy
You just need to run docker-compose-develop.yml, and you dont need any dependency
`docker-compose -f docker-compose-develop.yml up `

## Preview
It's the environment for calculate givback from aggregate donations fo https://giveth.io and https://trace.giveth.io
https://givback.develop.giveth.io/api-docs
