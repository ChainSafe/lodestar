import http, {Server} from "node:http";
import {Socket} from "node:net";
import {waitFor} from "@lodestar/utils";
import {IGauge} from "../../metrics/index.js";

export type SocketMetrics = {
  activeSockets: IGauge;
  socketsBytesRead: IGauge;
  socketsBytesWritten: IGauge;
};

// Use relatively short timeout to speed up shutdown
const GRACEFUL_TERMINATION_TIMEOUT = 1_000;

/**
 * From https://github.com/gajus/http-terminator/blob/aabca4751552e983f8a59ba896b7fb58ce3b4087/src/factories/createInternalHttpTerminator.ts#L24-L61
 * But only handles HTTP sockets, exposes the count of sockets as metrics
 */
export class HttpActiveSocketsTracker {
  private sockets = new Set<Socket>();
  private terminated = false;

  constructor(
    private readonly server: Server,
    metrics: SocketMetrics | null
  ) {
    server.on("connection", (socket) => {
      if (this.terminated) {
        socket.destroy(Error("Closing"));
      } else {
        this.sockets.add(socket);

        socket.once("close", () => {
          this.sockets.delete(socket);
          if (metrics) {
            metrics.socketsBytesRead.inc(socket.bytesRead);
            metrics.socketsBytesWritten.inc(socket.bytesWritten);
          }
        });
      }
    });

    if (metrics) {
      metrics.activeSockets.addCollect(() => metrics.activeSockets.set(this.sockets.size));
      // Note: After some testing seems that `socket.writableLength` does not provide useful data, it's always 0
    }
  }

  /**
   * Wait for all connections to drain, forcefully terminate any open connections after timeout
   *
   * From https://github.com/gajus/http-terminator/blob/aabca4751552e983f8a59ba896b7fb58ce3b4087/src/factories/createInternalHttpTerminator.ts#L78-L165
   * But only handles HTTP sockets and does not close server, immediately terminates eventstream API connections
   */
  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;

    // Inform new incoming requests on keep-alive connections that
    // the connection will be closed after the current response
    this.server.on("request", (_req, res) => {
      if (!res.headersSent) {
        res.setHeader("Connection", "close");
      }
    });

    for (const socket of this.sockets) {
      // This is the HTTP CONNECT request socket.
      // @ts-expect-error Unclear if I am using wrong type or how else this should be handled.
      if (!(socket.server instanceof http.Server)) {
        continue;
      }

      // @ts-expect-error Unclear if I am using wrong type or how else this should be handled.
      const serverResponse = socket._httpMessage as http.ServerResponse | undefined;

      if (serverResponse == null) {
        // Immediately destroy sockets without an attached HTTP request
        this.destroySocket(socket);
      } else if (serverResponse.getHeader("Content-Type") === "text/event-stream") {
        // eventstream API will never stop and must be forcefully terminated
        this.destroySocket(socket);
      } else if (!serverResponse.headersSent) {
        // Inform existing keep-alive connections that they will be closed after the current response
        serverResponse.setHeader("Connection", "close");
      }
    }

    // Wait for all connections to drain, forcefully terminate after timeout
    try {
      await waitFor(() => this.sockets.size === 0, {
        timeout: GRACEFUL_TERMINATION_TIMEOUT,
      });
    } catch {
      // Ignore timeout errors
    } finally {
      for (const socket of this.sockets) {
        this.destroySocket(socket);
      }
    }
  }

  private destroySocket(socket: Socket): void {
    socket.destroy(Error("Closing"));
    this.sockets.delete(socket);
  }
}
