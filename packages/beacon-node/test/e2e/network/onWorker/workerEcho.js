import worker from "node:worker_threads";

const parentPort = worker.parentPort;
if (!parentPort) throw Error("parentPort must be defined");

parentPort.on("message", (msg) => {
  // Echo back the data with the same id
  parentPort.postMessage({id: msg.id, data: msg.data});
});
