import net from "net";
import { WebSocket } from "ws";
import { Reader, Writer } from "bin-serde";

const NEW_STATE = 0;
const SUBSCRIBE_USER = 1;
const UNSUBSCRIBE_USER = 2;
const HANDLE_UPDATE = 3;

type StateId = bigint;
type UserId = string;

export class StoreClient {
  public constructor(private socket: net.Socket, connections: Map<StateId, Map<UserId, WebSocket>>) {
    socket.once("data", () => {
      readData(socket, (data) => {
        const reader = new Reader(data);
        const type = reader.readUInt8();
        if (type === 0) {
          const stateId = reader.readUInt64();
          const userId = reader.readString();
          const dataBuf = reader.readBuffer(reader.remaining());
          const userConnections = connections.get(stateId);
          userConnections?.get(userId)?.send(dataBuf);
        } else if (type === 1) {
          const stateId = reader.readUInt64();
          const userId = reader.readString();
          const userConnections = connections.get(stateId);
          userConnections?.get(userId)?.close(4000, "State not found");
          connections.delete(stateId);
        }
      });
    });
  }

  public newState(stateId: StateId, args: Buffer) {
    const buf = new Writer()
      .writeUInt32(9 + args.length)
      .writeUInt8(NEW_STATE)
      .writeUInt64(stateId)
      .writeBuffer(args)
      .toBuffer();
    this.socket.write(buf);
  }

  public subscribeUser(stateId: StateId, userId: UserId) {
    const userIdBuf = new Writer().writeString(userId).toBuffer();
    const buf = new Writer()
      .writeUInt32(9 + userIdBuf.length)
      .writeUInt8(SUBSCRIBE_USER)
      .writeUInt64(stateId)
      .writeBuffer(userIdBuf)
      .toBuffer();
    this.socket.write(buf);
  }

  public unsubscribeUser(stateId: StateId, userId: UserId) {
    const userIdBuf = new Writer().writeString(userId).toBuffer();
    const buf = new Writer()
      .writeUInt32(9 + userIdBuf.length)
      .writeUInt8(UNSUBSCRIBE_USER)
      .writeUInt64(stateId)
      .writeBuffer(userIdBuf)
      .toBuffer();
    this.socket.write(buf);
  }

  public handleUpdate(stateId: StateId, userId: UserId, args: Buffer) {
    const userIdBuf = new Writer().writeString(userId).toBuffer();
    const buf = new Writer()
      .writeUInt32(9 + userIdBuf.length + args.length)
      .writeUInt8(HANDLE_UPDATE)
      .writeUInt64(stateId)
      .writeBuffer(userIdBuf)
      .writeBuffer(args)
      .toBuffer();
    this.socket.write(buf);
  }
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
