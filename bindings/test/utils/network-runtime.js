import {createNativeNetwork as createNetwork} from "../../src/network.js";
import bindings from "../../src/bindings.js";
import {NativeIncoming} from "../../src/network-incoming.js";
import {NativeRequest} from "../../src/network-request.js";

const live = new Set();

/** A manually drained native instance. Observations are fixture state, not production query implementations. */
export function initializeNativeNetworkRuntime(config, onWorkAvailable, onPeers) {
  const runtime = new bindings.NativeNetworkRuntime();
  const initialized = runtime.initialize(config, onWorkAvailable);
  Object.assign(runtime, initialized);
  let identity = initialized.identity;
  const peers = new Map();
  const exchange = runtime.exchange.bind(runtime);
  const close = runtime.close.bind(runtime);
  const publish = runtime.publishGossip.bind(runtime);
  const applyIntent = runtime.applyIntent.bind(runtime);
  const diagnostics = runtime.getGossipDiagnostics.bind(runtime);
  const logs = runtime.drainLogs.bind(runtime);
  const connect = runtime.connect.bind(runtime);
  const report = runtime.reportPeer.bind(runtime);
  live.add(runtime);
  void runtime.closed.then(() => live.delete(runtime));
  runtime.observeIdentity = () => identity;
  runtime.observePeers = () => {
    const values = [...peers.values()];
    return {peers: values, counts: {connected: values.length, relevant: values.filter((peer) => peer.relevant).length}};
  };
  runtime.exchange = () => {
    const result = exchange();
    if (result.identity) identity = result.identity;
    onPeers?.(result.peers);
    for (const event of result.peers) {
      if (event.type === "closed") peers.delete(event.identity);
      else if (event.state.connection) peers.set(event.state.identity, event.state);
      else peers.delete(event.state.identity);
    }
    return {...result, serving: result.serving.map((descriptor) => new NativeIncoming(runtime, descriptor))};
  };
  runtime.close = () => { close(); return runtime.closed; };
  runtime.publishGossip = async (topic, data, options) => publish(topic, data, options);
  runtime.applyIntent = async (...args) => applyIntent(...args);
  runtime.getGossipDiagnostics = (cursor = 0) => diagnostics(cursor);
  runtime.drainLogs = (count = 256) => logs(count);
  runtime.connect = (peer, endpoints, timeout) => connect(peer, endpoints, timeout);
  runtime.reportPeer = (peer, action, context) => report(peer, action, context);
  runtime.request = (peer, protocol, data, options) => new NativeRequest(runtime, runtime.requestStart(peer, protocol, data, options));
  return runtime;
}

export {createNetwork as createNativeNetwork};

/** Accesses the raw binding only in tests that inspect the public wrapper's native work. */
export function runtimeOf(network) {
  const key = Object.getOwnPropertySymbols(network).find((symbol) => symbol.description === "NativeNetwork.runtime");
  return key === undefined ? undefined : network[key];
}
