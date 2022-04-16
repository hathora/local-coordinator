# Hathora Local Coordinator

Local coordinator for offline development of Hathora applications.

> Note: while this local coordinator is perflectly suitable for local development, it is missing several key features of the cloud coordinator and is not meant for production use

## How to use

### Setup

Generate certs using [mkcert](https://github.com/FiloSottile/mkcert):

```sh
mkcert -install
mkcert localhost
```

Install dependencies:

```sh
npm install
```

### Run

Start the coordinator process:

```sh
npx ts-node --esm coordinator.ts
```
