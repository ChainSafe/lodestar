import path from "node:path";
// It's a dev dependency
// eslint-disable-next-line import/no-extraneous-dependencies
import {config} from "dotenv";
const currentDir = new URL(".", import.meta.url).pathname;

config({path: path.join(currentDir, "../../../.env.test"), debug: true});
