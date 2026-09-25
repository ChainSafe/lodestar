import bindings from "@chainsafe/lodestar-z";
import {initializeNativeNetworkRuntime} from "@chainsafe/lodestar-z/network";

let runtime;
let active = 0;
let scheduled = false;
let retry;
const settleOnly = {
  settleCells: 32,
  peers: 0,
  checks: 0,
  servingStarts: 0,
  messages: 0,
  bytes: 0,
  claimOrdinary: false,
  capacity: null,
};
// The least a host does: settle results in later macrotasks while exchanges report more, and retry on a timer
// while payload waits for a service it disables.
function drain() {
  scheduled = false;
  const result = runtime.exchange([], settleOnly);
  if (result.more) schedule();
  else if (!result.rolledBack && result.disabledWaiting && !retry) {
    retry = setTimeout(() => {
      retry = undefined;
      schedule();
    }, 25);
    retry.unref();
  }
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setImmediate(drain);
}
process.on("message", async ({id, method, args}) => {
  if (++active > 16) process.exit(2);
  try {
    let value;
    switch (method) {
      case "initialize":
        bindings.config.set(args[1], args[2]);
        runtime = initializeNativeNetworkRuntime(args[0], schedule);
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
