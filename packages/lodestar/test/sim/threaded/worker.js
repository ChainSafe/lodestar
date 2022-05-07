import path from "node:path";
import {workerData} from "worker_threads";
import {fileURLToPath} from "node:url";

// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

await import("ts-node/esm");
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
await import(path.resolve(__dirname, workerData.path));
