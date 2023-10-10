import net from "node:net";
import {isMainThread, Worker} from "node:worker_threads";
import wtf from "wtfnode";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (isMainThread) {
  new Worker(new URL(import.meta.url));
} else {
  const sockets = [];
  const server = net.createServer({keepAlive: true}, (socket) => {
    sockets.push(socket);

    socket.on("error", (err) => {
      console.error("socket error", err);
    });
    socket.once("close", () => {
      sockets.splice(sockets.indexOf(socket), 1);
    });
  });

  server
    .on("listening", () => {
      console.info("Server started listening...", server.address());
      wtf.dump();
    })
    .on("close", () => {
      console.info("\n\nServer closed...");
      wtf.dump();
    })
    .on("error", (err) => {
      console.error("\n\nServer error: ", err);
    });

  server.listen({host: "localhost", port: 9999});
  const client = net.createConnection({host: "localhost", port: 9999}, () => {
    console.info("Client connected...");
    wtf.dump();
  });
  await sleep(2000);
  client.end();
  server.close();
}
