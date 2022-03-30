import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import crypto from "crypto";
import express from "express";
import cors from "cors";
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

const app = express();
app.use(express.json());
app.use(cors());
app.post("/:appId/login/anonymous", (req, res) => {
  const id = Math.random().toString(36).substring(2);
  const name = uniqueNamesGenerator({ dictionaries: [adjectives, colors, animals] });
  const user = { type: "anonymous", id, name };
  const token = `e30.${Buffer.from(JSON.stringify(user)).toString("base64")}`;
  res.json({ token });
});
app.post("/:appId/create", (req, res) => {
  const token = req.headers.authorization;
  if (token === undefined) {
    res.sendStatus(403);
  }
  const stateId = crypto.randomBytes(8).readBigUInt64LE();
  storeClient.newState(stateId);
  res.json({ stateId: stateId.toString(36) });
});
const server = https.createServer(options, app);

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.once("message", (data) => {
      if (data instanceof Buffer) {
        const reader = new Reader(data);
        const type = reader.readUInt8();
        if (type === 0) {
          const token = reader.readString();
          const userId = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString()).id;
          const stateId = reader.readUInt64();
          if (!connections.has(stateId)) {
            connections.set(stateId, new Map([]));
          }
          connections.get(stateId)!.set(userId, ws);
          storeClient.subscribeUser(stateId, userId);
          console.log("Got client connection", stateId.toString(36), userId);
          handleConnection(stateId, userId, ws);
        } else {
          throw new Error("Unexpected message type");
        }
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
