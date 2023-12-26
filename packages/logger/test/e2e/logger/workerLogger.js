import fs from "node:fs";
import worker from "node:worker_threads";
import {expose} from "@chainsafe/threads/worker";

const parentPort = worker.parentPort;
const workerData = worker.workerData;
if (!parentPort) throw Error("parentPort must be defined");

const file = fs.createWriteStream(workerData.logFilepath, {flags: "a"});

parentPort.on("message", (data) => {
  // eslint-disable-next-line no-console
  console.log(data);
  file.write(data);
});

expose(() => {
  //
});
