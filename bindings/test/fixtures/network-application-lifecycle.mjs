import {applicationConfig, localIntent, startRuntime} from "../utils/network.js";

const config = applicationConfig();
const runtime = startRuntime(config);
await runtime.applyIntent(localIntent(config));
await runtime.close();
console.log("application-closed-exit");
