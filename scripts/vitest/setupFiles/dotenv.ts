import path from "node:path";
// It's a dev dependency
// eslint-disable-next-line import/no-extraneous-dependencies
import {config} from "dotenv";
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = new URL(".", import.meta.url).pathname;

config({path: path.join(__dirname, "../../../.env.test")});
