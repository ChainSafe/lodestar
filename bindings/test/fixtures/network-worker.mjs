import {startRuntime} from "../utils/network.js";
import {parentPort} from "node:worker_threads";

import {applicationConfig} from "../utils/network.ts";
const runtime = startRuntime(applicationConfig(), () => undefined);
const identity = await runtime.identity;
parentPort.postMessage(identity.localEndpoint.port);
parentPort.on("message", () => undefined);
