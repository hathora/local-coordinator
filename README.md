# Hathora Local Coordinator

Local coordinator for offline development of Hathora applications.

> Note: while this local coordinator is perflectly suitable for local development, it is missing several key features of the cloud coordinator and is not meant for production use

## How to use

### 1. Enable HTTPS for localhost

First, generate certificates using [mkcert](https://github.com/FiloSottile/mkcert).

```sh
mkcert -install
mkcert localhost
```

Make sure to add `*.pem` to your `.gitignore` file to avoid committing the certificate files.

### 2. Add `local-coordinator` to your Hathora project

In your project root directory:

- Install with `npm i https://github.com/hathora/local-coordinator.git`
- Start the coordinator with `npx local-coordinator` and keep it running during development.
- Then you can open another terminal and run `COORDINATOR_HOST=localhost npx hathora dev` to make hathora connect to your `local-coordinator`.


To simplify your workflow, it's highly recommended to add scripts to `package.json`.

```json
"scripts": {
  "coordinator": "local-coordinator",
  "dev": "COORDINATOR_HOST=localhost hathora dev"
}
```

Now you can start your offline Hathora dev environment by creating two terminals where you run `npm run coordinator` in the first, and `npm run dev` in the second.

Happy codning! 🪴
