import bindings from "../../src/bindings.js";
import {exchange, gossipAll, nextIncoming, startRuntime} from "../utils/network.js";

let runtime;
let sequence = 0;
const requests = new Map();
const incoming = new Map();
const releases = new Map();
process.on("disconnect", async () => {
  await runtime?.close();
  process.exit(0);
});
const methods = new Set([
  "applyIntent",
  "updateStatus",
  "observeIdentity",
  "observePeers",
  "getGossipDiagnostics",
  "getPeerScores",
  "connect",
  "disconnect",
  "reStatusPeers",
  "addDirectPeer",
  "removeDirectPeer",
  "exchange",
  "setCapacity",
  "reportGossip",
  "classifyGossip",
  "notifyBlock",
  "reportPeer",
  "publishGossip",
  "getMetrics",
  "drainLogs",
  "setLogLevel",
  "close",
]);
async function execute(method, args) {
  if (method === "initialize") {
    args[0].beaconConfig = new bindings.BeaconConfig(args[1], args[1].genesisValidatorsRoot);
    runtime = startRuntime(args[0]);
    return runtime.identity;
  }
  if (!runtime) throw new Error("Network peer uninitialized");
  if (method === "exchange") return exchange(runtime, gossipAll);
  if (methods.has(method)) return runtime[method](...args);
  if (method === "closed") return runtime.closed;
  if (method === "request") {
    if (requests.size >= 64) throw new Error("Network peer request capacity");
    const id = ++sequence;
    requests.set(id, runtime.request(...args));
    return id;
  }
  if (method === "requestNext" || method === "requestReturn") {
    const iterator = requests.get(args[0]);
    if (!iterator) return {done: true, value: undefined};
    try {
      const result = await (method === "requestNext" ? iterator.next() : iterator.return());
      if (result.done) requests.delete(args[0]);
      return result;
    } catch (error) {
      requests.delete(args[0]);
      throw error;
    }
  }
  if (method === "takeIncomingRequest") {
    if (incoming.size >= 64) throw new Error("Network peer incoming capacity");
    const request = nextIncoming(runtime);
    if (!request) return null;
    const id = ++sequence;
    incoming.set(id, request);
    request.retainUntil(new Promise((resolve) => releases.set(id, resolve)));
    const {peerId, connection, protocol, data} = request;
    return {id, peerId, connection, protocol, data};
  }
  if (method === "incomingRelease") {
    releases.get(args[0])?.();
    releases.delete(args[0]);
    incoming.delete(args[0]);
    return;
  }
  const request = incoming.get(args[0]);
  if (!request) throw new Error("Unknown network peer operation");
  const operation = {
    incomingReady: "ready",
    incomingRespond: "respond",
    incomingFinish: "finish",
    incomingFail: "fail",
    incomingCancel: "cancel",
  }[method];
  if (operation) return request[operation](...args.slice(1));
  if (method === "incomingClosed") {
    await request.closed;
    return;
  }
  throw new Error("Unknown network peer operation");
}
let commands = 0;
process.on("message", async ({id, method, args}) => {
  if (++commands > 256) process.exit(2);
  try {
    const value = await execute(method, args);
    process.send?.({id, value});
  } catch (error) {
    process.send?.({id, error: {message: error.message, stack: error.stack, ...error}});
  } finally {
    commands--;
  }
});
