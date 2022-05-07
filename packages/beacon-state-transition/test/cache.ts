import path from "node:path";
import {fileURLToPath} from "node:url";

// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const testCachePath = path.join(__dirname, "../test-cache");
