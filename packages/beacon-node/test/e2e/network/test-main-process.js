import net from "node:net";
import wtf from "wtfnode";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const sockets = [];

const server = net.createServer({keepAlive: true}, (socket) => {
  sockets.push(socket);

  socket.on("error", (err) => {
    console.error("socket error", err);
  });
  socket.on("end", () => {
    socket.end();
    sockets.splice(sockets.indexOf(socket), 1);
    console.info("Client ended...");
    wtf.dump();
  });

  socket.once("close", () => {
    console.info("socket closed on server side");
    socket.end();
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
