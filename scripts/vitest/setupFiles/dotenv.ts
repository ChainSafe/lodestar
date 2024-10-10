import path from "node:path";
// It's a dev dependency
import {config} from "dotenv";
const __dirname = new URL(".", import.meta.url).pathname;

config({path: path.join(__dirname, "../../../.env.test")});
