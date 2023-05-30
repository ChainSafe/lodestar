import worker from "node:worker_threads";
import {expose} from "@chainsafe/threads/worker";

const parentPort = worker.parentPort;
if (!parentPort) throw Error("parentPort must be defined");

parentPort.on("message", (data) => {
  parentPort.postMessage(data);
});

expose(() => {
  //
});
