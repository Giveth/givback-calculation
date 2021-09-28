This project has a endpoint to calculate the GIVback rewards.
the calculation formula  inspired by  https://github.com/Giveth/givbacks-scripts

## Requirements
Node 10 or higher

## Instalation and run
1. `git clone `
2. `npm i`
3. GIVETHIO_BASE_URL=https://mainnet.serve.giveth.io TRACE_BASE_URL=https://feathers.beta.giveth.io npm start
4. Browse `http://localhost:3000/api-docs`


## Deploy
You just need to run docker-compose-develop.yml, and you dont need any dependency
`docker-compose -f docker-compose-develop.yml up `
