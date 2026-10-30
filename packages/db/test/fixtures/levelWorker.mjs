import {parentPort, workerData} from "node:worker_threads";
import {getEnvLogger} from "@lodestar/logger/env";
import {LevelDbController} from "../../lib/controller/level.js";

const db = await LevelDbController.create({name: workerData.name}, {logger: getEnvLogger()});
let result;
try {
  result = await db.get(Uint8Array.of(1));
  await db.put(Uint8Array.of(2), Uint8Array.of(22));
} finally {
  await db.close();
}
parentPort.postMessage(result);
