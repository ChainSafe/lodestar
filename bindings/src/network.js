import bindings from "./bindings.js";
import {PublicationCapacityWaiters, RequestCapacityWaiters} from "./network-capacity.js";
import {CommandQueue} from "./network-commands.js";
import {NativePump} from "./network-pump.js";
import {NativeRequest} from "./network-request.js";

const openNetworks = new Set();
const NATIVE = Symbol("NativeNetwork.runtime");

const HOST_METHODS = [
  "capacity",
  "subscribeCapacity",
  "validate",
  "checkDependencies",
  "serve",
  "peers",
  "failed",
  "logs",
];
const CONNECT_TIMEOUT_MS = 10000n;

class NativeNetwork {
  #native;
  #pump;
  #requestCapacity;
  #commands;
  #publicationCapacity;
  #metricsPending = null;
  #identity;
  #directPeers = new Set();
  #directPending = Promise.resolve();
  #closing = false;

  constructor(config, host) {
    for (const name of HOST_METHODS)
      if (typeof host?.[name] !== "function") throw new TypeError(`NativeHost.${name} must be a function`);
    const pump = new NativePump(
      host,
      (identity) => {
        this.#identity = identity;
      },
      () => {
        this.#commands.changed();
        this.#requestCapacity.changed();
        this.#publicationCapacity.changed();
        host.requestCapacityChanged?.();
      }
    );
    const native = new bindings.NativeNetworkRuntime();
    const initialized = native.initialize(config, pump.request);
    this.#native = native;
    this.#commands = new CommandQueue((token) => native.commandCapacityWatch(token));
    this.#requestCapacity = new RequestCapacityWaiters(native);
    this.#publicationCapacity = new PublicationCapacityWaiters(native);
    this.#identity = initialized.identity;
    Object.defineProperty(this, NATIVE, {value: native});
    pump.attach(native, initialized.closed);
    this.#pump = pump;
    this.limits = Object.freeze({...initialized.limits});
    this.closed = initialized.closed;
    openNetworks.add(this);
    void this.closed.then(() => {
      this.#commands.close();
      this.#requestCapacity.close();
      this.#publicationCapacity.close();
      this.#closing = true;
      openNetworks.delete(this);
    });
  }

  async applyIntent(intent) {
    return this.#command("applyIntent", [intent], "state");
  }
  async updateStatus(status) {
    return this.#command("updateStatus", [status], "state");
  }
  blockImported(root) {
    this.#native.notifyBlock(root);
  }
  reportPeer(peerId, action, context) {
    this.#native.reportPeer(peerId, action, context);
  }
  dropQueuedGossip() {
    this.#native.dropQueuedGossip();
  }
  stopDelivery() {
    this.#pump.stopDelivery();
  }
  async publish(topic, data, options) {
    return this.#native.publishGossip(topic, data, options);
  }
  waitForPublicationCapacity(token, options) {
    return this.#publicationCapacity.wait(token, options);
  }
  request(peerId, protocol, data, options) {
    return new NativeRequest(this.#native, this.#native.requestStart(peerId, protocol, data, options));
  }
  waitForRequestCapacity(token, options) {
    return this.#requestCapacity.wait(token, options);
  }
  watchRequestCapacity(token) {
    return this.#native.requestCapacityWatch(token);
  }
  async connect(peerId, endpoints, timeoutMs = CONNECT_TIMEOUT_MS) {
    return this.#command("connect", [peerId, endpoints, timeoutMs], peerId);
  }
  async disconnect(peerId) {
    this.#commands.cancelConnect(peerId);
    return this.#command("disconnect", [peerId], peerId);
  }
  async setDirectPeer(peerId, endpoints) {
    const operation =
      endpoints === null
        ? this.#command("removeDirectPeer", [peerId], peerId)
        : this.#command("addDirectPeer", [peerId, endpoints], peerId);
    // Native completions need not settle in submission order. Apply membership changes in that order.
    const outcome = operation.then(
      (value) => ({value}),
      (error) => ({error})
    );
    const applied = this.#directPending.then(async () => {
      const result = await outcome;
      if ("error" in result) throw result.error;
      if (endpoints === null) this.#directPeers.delete(peerId);
      else this.#directPeers.add(peerId);
      return result.value;
    });
    this.#directPending = applied.then(
      () => undefined,
      () => undefined
    );
    return applied;
  }
  async reStatus(peerIds) {
    return this.#command("reStatusPeers", [peerIds]);
  }
  async getIdentity() {
    this.#checkOpen();
    return structuredClone(this.#identity);
  }
  async getDirectPeers() {
    this.#checkOpen();
    return [...this.#directPeers];
  }
  async getPeerScores() {
    return this.#command("getPeerScores", []);
  }
  async getGossipDiagnostics(cursor = 0) {
    return this.#command("getGossipDiagnostics", [cursor]);
  }

  metrics() {
    this.#metricsPending ??= this.#collectMetrics().finally(() => {
      this.#metricsPending = null;
    });
    return this.#metricsPending;
  }
  async #collectMetrics() {
    this.#checkOpen();
    return (await this.#command("getMetrics", [])) + this.#pump.metrics();
  }
  setLogLevel(level) {
    this.#native.setLogLevel(level);
  }
  #command(name, args, key) {
    this.#checkOpen();
    const input = structuredClone(args);
    return this.#commands.submit(() => this.#native[name](...input), key, name === "connect" ? input[0] : undefined);
  }
  #checkOpen() {
    if (this.#closing) throw Object.assign(new Error("NetworkClosed"), {code: "NetworkClosed"});
  }
  close() {
    this.#closing = true;
    this.#commands.close();
    this.#requestCapacity.close();
    this.#publicationCapacity.close();
    this.#pump.stopDelivery();
    this.#native.close();
    return this.closed;
  }
}

/**
 * Keeps the wrapper and event loop alive until close. The binding-owned pump invokes no host callback
 * synchronously; its first turn subscribes to host capacity and reads its initial value.
 */
export function createNativeNetwork(config, host) {
  return new NativeNetwork(config, host);
}
