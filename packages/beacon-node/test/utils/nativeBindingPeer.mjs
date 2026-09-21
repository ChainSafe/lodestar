import bindings from "@chainsafe/lodestar-z";
import {initializeNativeNetworkRuntime} from "@chainsafe/lodestar-z/network";

let runtime;
let active = 0;
process.on("message", async ({id, method, args}) => {
  if (++active > 16) process.exit(2);
  try {
    let value;
    switch (method) {
      case "initialize":
        bindings.config.set(args[1], args[2]);
        runtime = initializeNativeNetworkRuntime(args[0], () => {});
        value = runtime.identity;
        break;
      case "applyIntent":
        value = await runtime.applyIntent(...args);
        break;
      case "getPeers":
        value = await runtime.getPeers();
        break;
      case "close":
        value = await runtime.close();
        break;
      default:
        throw new Error("Unknown native binding peer command");
    }
    process.send({id, value});
  } catch (error) {
    process.send({id, error});
  } finally {
    active--;
  }
});
process.on("disconnect", async () => {
  await runtime?.close();
  process.exit(0);
});
