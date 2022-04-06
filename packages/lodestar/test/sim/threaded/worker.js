import path from "node:path";
import {workerData} from "worker_threads";
import {fileURLToPath} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await import("ts-node/esm");
await import(path.resolve(__dirname, workerData.path));
