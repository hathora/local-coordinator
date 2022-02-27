import fs from "fs";
import http from "http";
import https from "https";
import net from "net";
import crypto from "crypto";
import { uniqueNamesGenerator, adjectives, colors, animals } from "unique-names-generator";
import { WebSocketServer, WebSocket } from "ws";
import { Reader, Writer } from "bin-serde";

const NEW_STATE = 0;
const SUBSCRIBE_USER = 1;
const UNSUBSCRIBE_USER = 2;
const HANDLE_UPDATE = 3;

type StateId = bigint;
type UserId = string;
const connections: Map<StateId, Map<UserId, Set<WebSocket>>> = new Map();

let storeSocket: net.Socket | undefined;
const coordinatorServer = net.createServer((socket) => {
  storeSocket = socket;
  console.log("Got store connection");
  socket.once("data", () => {
    readData(socket, (data) => {
      const sb = new Reader(data);
      const stateId = sb.readUInt64();
      const userId = sb.readString();
      const dataBuf = sb.readBuffer(sb.remaining());

      const userConnections = connections.get(stateId);
      if (dataBuf.length === 0) {
        userConnections?.get(userId)?.forEach((conn) => conn.close(4000, "State not found"));
        connections.delete(stateId);
      } else {
        userConnections?.get(userId)?.forEach((conn) => conn.send(dataBuf));
      }
    });
  });
});
coordinatorServer.listen(7147, () => {
  console.log("Listening on port 7147 for tcp connections");
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
    let userId: UserId | undefined;
    ws.onmessage = ({ data }) => {
      if (userId === undefined) {
        const token = data as string;
        userId = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString()).id;
        return;
      }

      let stateId;
      if (data instanceof Buffer) {
        stateId = crypto.randomBytes(8).readBigUInt64LE();
        connections.set(stateId, new Map([[userId, new Set([ws])]]));
        sendNewState(stateId, userId, data);
        ws.send(stateId.toString(36));
      } else if (typeof data === "string") {
        stateId = [...data].reduce((r, v) => r * BigInt(36) + BigInt(parseInt(v, 36)), 0n);
        if (!connections.has(stateId)) {
          connections.set(stateId, new Map([]));
        }
        if (!connections.get(stateId)!.has(userId)) {
          connections.get(stateId)!.set(userId, new Set([]));
        }
        connections.get(stateId)!.get(userId)!.add(ws);
        sendSubscribeUser(stateId, userId);
      } else {
        throw new Error("Unexpected message type");
      }
      console.log("Got client connection", stateId.toString(36), userId);
      handleConnection(stateId, userId, ws);
    };
  });
});
server.listen(443, () => {
  console.log("Listening on port 443 for http connections");
});

function handleConnection(stateId: StateId, userId: UserId, socket: WebSocket) {
  socket.on("close", () => {
    if (!connections.has(stateId)) {
      return;
    }
    connections.get(stateId)!.get(userId)!.delete(socket);
    if (connections.get(stateId)!.get(userId)!.size === 0) {
      connections.get(stateId)!.delete(userId);
      sendUnsubscribeUser(stateId, userId);
    }
    if (connections.get(stateId)!.size === 0) {
      connections.delete(stateId);
    }
  });
  socket.on("message", (data) => {
    sendHandleUpdate(stateId, userId, data as Buffer);
  });
}

function sendNewState(stateId: StateId, userId: UserId, data: Buffer) {
  const userIdBuf = new Writer().writeString(userId).toBuffer();
  const buf = new Writer()
    .writeUInt32(9 + userIdBuf.length + data.length)
    .writeUInt8(NEW_STATE)
    .writeUInt64(stateId)
    .writeBuffer(userIdBuf)
    .writeBuffer(data)
    .toBuffer();
  storeSocket!.write(buf);
}

function sendSubscribeUser(stateId: StateId, userId: UserId) {
  const userIdBuf = new Writer().writeString(userId).toBuffer();
  const buf = new Writer()
    .writeUInt32(9 + userIdBuf.length)
    .writeUInt8(SUBSCRIBE_USER)
    .writeUInt64(stateId)
    .writeBuffer(userIdBuf)
    .toBuffer();
  storeSocket!.write(buf);
}

function sendUnsubscribeUser(stateId: StateId, userId: UserId) {
  const userIdBuf = new Writer().writeString(userId).toBuffer();
  const buf = new Writer()
    .writeUInt32(9 + userIdBuf.length)
    .writeUInt8(UNSUBSCRIBE_USER)
    .writeUInt64(stateId)
    .writeBuffer(userIdBuf)
    .toBuffer();
  storeSocket!.write(buf);
}

function sendHandleUpdate(stateId: StateId, userId: UserId, args: Buffer) {
  const userIdBuf = new Writer().writeString(userId).toBuffer();
  const buf = new Writer()
    .writeUInt32(9 + userIdBuf.length + args.length)
    .writeUInt8(HANDLE_UPDATE)
    .writeUInt64(stateId)
    .writeBuffer(userIdBuf)
    .writeBuffer(args)
    .toBuffer();
  storeSocket!.write(buf);
}

function readData(socket: net.Socket, onData: (data: Buffer) => void) {
  let buf = Buffer.alloc(0);
  socket.on("data", (data) => {
    buf = Buffer.concat([buf, data]);
    while (buf.length >= 4) {
      const bufLen = buf.readUInt32BE();
      if (buf.length < 4 + bufLen) {
        return;
      }
      onData(buf.slice(4, 4 + bufLen));
      buf = buf.slice(4 + bufLen);
    }
  });
}
