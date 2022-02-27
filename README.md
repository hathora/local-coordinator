# Hathora Local Coordinator

Local coordinator for offline development of Hathora applications.

## How to run

Generate certs using mkcert:

```sh
mkcert -install
mkcert localhost
```

Install dependencies:

```sh
npm install
```

Run coordinator server:

```sh
node --loader ts-node/esm coordinator.ts
```
