import net from "node:net";

const sockets = [];
const server = net.createServer({keepAlive: true}, function req(socket) {
  sockets.push(socket);
  socket.on("close", () => {
    console.log("socket closed", socket.remoteAddress, socket.remotePort);
    sockets.splice(sockets.indexOf(socket), 1);
  });
});

server.listen(9999);

for (let i = 0; i < 10; i++) {
  const socket = net.createConnection({host: "localhost", port: 9999});
  socket.on("ready", () => {
    console.log("socket ready", socket.remoteAddress, socket.remotePort);
  });
}

// server.close();

setTimeout(() => {
  console.log("server closing...", server.listening);
  server.close();
  console.log("server closed...", server.listening);
  for (const socket of sockets) {
    socket.destroy();
  }
  console.log("server closed...", server.listening);
}, 4000);
