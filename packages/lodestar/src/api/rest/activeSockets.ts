import http, {Server} from "node:http";
import {Socket} from "node:net";

/**
 * From https://github.com/nodejs/node/blob/57bd715d527aba8dae56b975056961b0e429e91e/lib/_http_client.js#L363-L413
 * But exposes the count of sockets, and does not have a graceful period
 */
export class HttpActiveSocketsTracker {
  private sockets = new Set<Socket>();
  private terminated = false;

  constructor(server: Server) {
    server.on("connection", (socket) => {
      if (this.terminated) {
        socket.destroy(Error("Closing"));
      } else {
        this.sockets.add(socket);

        socket.once("close", () => {
          this.sockets.delete(socket);
        });
      }
    });
  }

  get count(): number {
    return this.sockets.size;
  }

  destroyAll(): void {
    this.terminated = true;

    for (const socket of this.sockets) {
      // This is the HTTP CONNECT request socket.
      // @ts-expect-error Unclear if I am using wrong type or how else this should be handled.
      if (!(socket.server instanceof http.Server)) {
        continue;
      }

      socket.destroy(Error("Closing"));
      this.sockets.delete(socket);
    }
  }
}
