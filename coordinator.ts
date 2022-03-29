import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import crypto from "crypto";
import { uniqueNamesGenerator, adjectives, colors, animals } from "unique-names-generator";
import { WebSocketServer, WebSocket } from "ws";
import { StoreClient } from "./store-client.js";
import { Reader } from "bin-serde";

type StateId = bigint;
type UserId = string;
const connections: Map<StateId, Map<UserId, WebSocket>> = new Map();

const storeClient = await new Promise<StoreClient>((resolve) => {
  const coordinatorServer = net.createServer((socket) => {
    console.log("Got store connection");
    resolve(new StoreClient(socket, connections));
  });
  coordinatorServer.listen(7147, () => console.log("Listening on port 7147 for tcp connections"));
});

const options = {
  key: fs.readFileSync("localhost-key.pem"),
  cert: fs.readFileSync("localhost.pem"),
};
const server = https.createServer(options, (req, res) => {
  const id = Math.random().toString(36).substring(2);
  const name = uniqueNamesGenerator({ dictionaries: [adjectives, colors, animals] });
  const user = { type: "anonymous", id, name };
  const token = `e30.${Buffer.from(JSON.stringify(user)).toString("base64")}`;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ token }));
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.once("message", (data) => {
      if (data instanceof Buffer) {
        const reader = new Reader(data);
        const type = reader.readUInt8();
        const token = reader.readString();
        const userId = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString()).id;
        let stateId;
        if (type === 0) {
          stateId = crypto.randomBytes(8).readBigUInt64LE();
          connections.set(stateId, new Map([[userId, ws]]));
          storeClient.newState(stateId);
          storeClient.subscribeUser(stateId, userId);
          ws.send(stateId.toString(36));
        } else if (type === 1) {
          stateId = reader.readUInt64();
          if (!connections.has(stateId)) {
            connections.set(stateId, new Map([]));
          }
          connections.get(stateId)!.set(userId, ws);
          storeClient.subscribeUser(stateId, userId);
        } else {
          throw new Error("Unexpected message type");
        }
        console.log("Got client connection", stateId.toString(36), userId);
        handleConnection(stateId, userId, ws);
      } else {
        throw new Error("Unexpected data type");
      }
    });
  });
});
server.listen(443, () => console.log("Listening on port 443 for http connections"));

function handleConnection(stateId: StateId, userId: UserId, socket: WebSocket) {
  socket.on("close", () => {
    if (!connections.has(stateId)) {
      return;
    }
    connections.get(stateId)!.delete(userId);
    storeClient.unsubscribeUser(stateId, userId);
    if (connections.get(stateId)!.size === 0) {
      connections.delete(stateId);
    }
  });
  socket.on("message", (data) => storeClient.handleUpdate(stateId, userId, data as Buffer));
}
