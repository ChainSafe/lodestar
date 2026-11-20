// @ts-check
import assert from "node:assert/strict";
import {NativeIncoming} from "./network-incoming.js";
import {LogDelivery} from "./network-log-delivery.js";
import {TurnScheduler} from "./network-turn-scheduler.js";

/**
 * @typedef {import("./network-turn-scheduler.js").Continuation} Continuation
 * @typedef {import("./network-types.js").NativeGossipHandle} Handle
 * @typedef {import("./network-types.js").NativeIncomingRequest} Incoming
 * @typedef {import("./network-types.js").NativeDelivery} Exchange
 * @typedef {import("./network.js").NativeHost} Host
 * @typedef {import("./network.js").CloseResult} CloseResult
 * @typedef {import("./network.js").GossipJob} GossipJob
 * @typedef {import("./network.js").NativeForkEntry} NativeForkEntry
 * @typedef {import("./network.js").Verdict} Verdict
 * @typedef {import("./network-types.js").NativeBridge} NativeBridge
 * @typedef {import("./network-types.js").NativeGossipBatch} NativeGossipBatch
 * @typedef {import("./network-types.js").NativeGossipDependencyCheck} NativeGossipDependencyCheck
 * @typedef {{adopted: boolean, handles: Handle[], job: GossipJob | null}} Job
 * @typedef {Pick<NativeBridge, "drainLogs" | "setCapacity" | "reportGossip" | "classifyGossip"> & {
 * close(): void,
 * exchange(): Exchange,
 * }} Runtime
 */

export const BURST_NAME = "lodestar_network_drain_burst_seconds";
export const BURST_BUCKETS = Object.freeze([0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2]);
const VERDICTS = new Set(["accept", "reject", "ignore"]);
const noop = () => undefined;

/** @param {string} callback */
function contractError(callback) {
  return Object.assign(new Error(`NativeHostContract: ${callback}`), {callback, code: "NativeHostContract"});
}

/** The public view of a serving start: the native handle and retention stay with the binding. */
class IncomingRequest {
  #incoming;

  /** @param {Incoming} incoming */
  constructor(incoming) {
    this.#incoming = incoming;
    this.peerId = incoming.peerId;
    this.connection = incoming.connection;
    this.protocol = incoming.protocol;
    this.data = incoming.data;
    this.closed = incoming.closed;
  }

  ready() {
    return this.#incoming.ready();
  }
  /**
   * @param {Uint8Array} data
   * @param {NativeForkEntry | null} context
   */
  respond(data, context) {
    return this.#incoming.respond(data, context);
  }
  finish() {
    return this.#incoming.finish();
  }
  /**
   * @param {number} status
   * @param {Uint8Array} message
   */
  fail(status, message) {
    return this.#incoming.fail(status, message);
  }
  cancel() {
    return this.#incoming.cancel();
  }
}

/**
 * Each bounded macrotask settles native Promises, then delivers peers, serving starts, dependency checks and gossip.
 * Notifications, capacity recovery and remaining work schedule further turns. Host feedback reaches native directly.
 * Stopping payload delivery leaves Promise settlement running through close. Host tasks hold the pump weakly.
 */
export class NativePump {
  /** @type {Runtime | null} */
  #runtime = null;
  #scheduler = new TurnScheduler(this);
  #host;
  /** @type {Error | null} */
  #failure = null;
  #weak = new WeakRef(this);
  #deliveryStopped = false;
  /** @type {(() => void) | null} */
  #unsubscribeCapacity = null;
  #stopped = false;
  #burst = {buckets: new Array(BURST_BUCKETS.length).fill(0), count: 0, sum: 0};
  /** @type {LogDelivery | null} */
  #logs = null;
  /** @type {(identity: import("./network.js").NativeIdentity) => void} */
  #onIdentity;
  /** @type {() => void} */
  #onCapacity;

  /**
   * @param {Host} host
   * @param {(identity: import("./network.js").NativeIdentity) => void} [onIdentity]
   * @param {() => void} [onCapacity]
   */
  constructor(host, onIdentity = () => undefined, onCapacity = () => undefined) {
    this.#host = host;
    this.#onIdentity = onIdentity;
    this.#onCapacity = onCapacity;
  }

  /**
   * Starts draining `runtime`, whose notifications call `request`, and delivering its log records.
   * @param {Runtime} runtime
   * @param {Promise<CloseResult>} closed
   */
  attach(runtime, closed) {
    this.#runtime = runtime;
    const stop = () => this.#stop();
    closed.then(stop, stop);
    this.#logs = new LogDelivery(runtime, this.#host, /** @param {unknown} error */ (error) => this.#error(error));
    this.#logs.start();
    this.#schedule();
  }

  /** A native notification, or capacity the host released. */
  request = () => this.#schedule();

  /**
   * Leaves settlement only until native reports closed. From a host callback, it also ends the delivery in progress;
   * that delivery's cleanup cancels unstarted requests and ignores jobs it never handed over.
   */
  stopDelivery() {
    if (this.#deliveryStopped) return;
    this.#deliveryStopped = true;
    const unsubscribe = this.#unsubscribeCapacity;
    this.#unsubscribeCapacity = null;
    try {
      unsubscribe?.();
    } catch (error) {
      this.#error(error);
    }
    this.#schedule();
  }

  /**
   * Reports one host failure after delivery cleanup; settlement continues until the host closes native.
   * @param {unknown} error
   */
  #fail(error) {
    if (this.#stopped || this.#failure) return;
    const failure = error instanceof Error ? error : Object.assign(new Error("NativeHostFailure"), {cause: error});
    this.#failure = failure;
    this.stopDelivery();
    try {
      this.#host.failed(failure);
    } catch (thrown) {
      // A host that cannot clean up leaves nothing to wait for.
      this.#error(thrown);
      try {
        this.#runtime?.close();
      } catch {
        // A runtime that cannot close is already closing.
      }
    }
  }

  /**
   * An operational failure the pump recovered from, for the host to log.
   * @param {unknown} error
   */
  #error(error) {
    try {
      this.#host.error?.(error);
    } catch {
      // Reporting a recovered failure must not stop the pump.
    }
  }

  #schedule() {
    if (!this.#stopped) this.#scheduler.schedule();
  }

  #stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#scheduler.stop();
    this.stopDelivery();
    // Native keeps its records past close, so the last ones, the shutdown's included, still reach the host.
    this.#logs?.stop();
  }

  /**
   * One of the runtime's turns. Returns when the next is due: now or idle.
   * @returns {Continuation}
   */
  turn() {
    if (this.#stopped) return "idle";
    const started = performance.now();
    try {
      return this.#turn();
    } finally {
      // The burst end is queued first, so it covers only this turn.
      setImmediate(NativePump.#burstEnd, this.#weak, started);
    }
  }

  #demand() {
    if (this.#deliveryStopped) return null;
    if (this.#unsubscribeCapacity === null) {
      // Subscribe before reading: recovery during the read must schedule another turn.
      const unsubscribe = this.#host.subscribeCapacity(this.request);
      if (typeof unsubscribe !== "function") throw contractError("subscribeCapacity");
      if (this.#deliveryStopped) {
        unsubscribe();
        return null;
      }
      this.#unsubscribeCapacity = unsubscribe;
    }
    const capacity = this.#host.capacity();
    if (this.#deliveryStopped) return null;
    if (capacity?.gossipValidation !== "ready" && capacity?.gossipValidation !== "backpressured")
      throw contractError("capacity");
    return {gossipValidation: capacity.gossipValidation};
  }

  /**
   * @returns {Continuation}
   */
  #turn() {
    assert(this.#runtime !== null);
    let demand = null;
    try {
      demand = this.#demand();
    } catch (error) {
      this.#fail(error);
    }
    let result;
    try {
      this.#runtime.setCapacity(demand);
      result = this.#runtime.exchange();
      if (result.identity) this.#onIdentity(result.identity);
    } catch (error) {
      this.#fail(error);
      return "idle";
    }
    try {
      this.#deliver(result);
    } catch (error) {
      this.#fail(error);
    }
    return result.needsAnotherExchange ? "now" : "idle";
  }

  /**
   * Hands one exchange's delivery to the host: peers, then serving starts, then dependency checks, then gossip jobs.
   * If the host's peer handler throws, or the host closes the network, the delivery stops there and the pump retires
   * what it never handed over: every job gets an ignore verdict, every serving start is cancelled once and every check
   * is classified unavailable.
   *
   * @param {Exchange} result
   */
  #deliver(result) {
    const jobs = this.#jobs(result.gossip);
    const starts = result.serving.map((descriptor) => ({
      adopted: false,
      incoming: new NativeIncoming(this.#runtime, descriptor),
    }));
    const checks = result.checks;
    let checked = checks.length === 0;
    try {
      if (result.capacityChanged) this.#onCapacity();
      // Host code may already have run within the exchange's settlements.
      if (this.#deliveryStopped) return;
      if (result.peers.length > 0) this.#host.peers(result.peers);
      if (this.#deliveryStopped) return;
      for (const start of starts) {
        if (this.#deliveryStopped) return;
        start.adopted = true;
        this.#serve(start.incoming);
      }
      if (this.#deliveryStopped) return;
      this.#check(checks);
      checked = true;
      for (const job of jobs) {
        if (this.#deliveryStopped) return;
        job.adopted = true;
        this.#validate(job);
      }
    } finally {
      for (const job of jobs) if (!job.adopted) this.#verdicts(job, null);
      for (const start of starts) if (!start.adopted) void start.incoming.cancel().catch(noop);
      if (!checked) for (const {handle} of checks) this.#runtime?.classifyGossip(handle, false);
    }
  }

  /**
   * Jobs with host records that physically omit native handles, each awaiting every message's disposition.
   * @param {NativeGossipBatch | null} gossip
   * @returns {Job[]}
   */
  #jobs(gossip) {
    if (!gossip) return [];
    return gossip.jobs.map(({kind, grouped, start, length}) => {
      const natives = gossip.messages.slice(start, start + length);
      const messages = natives.map((message) => ({
        attestationData: message.attestationData,
        connection: message.connection,
        data: message.data,
        endpoint: message.endpoint,
        id: message.id,
        peerId: message.peerId,
        receivedAtUnixMs: message.receivedAtUnixMs,
        slot: message.slot,
        topic: message.topic,
      }));
      return {
        adopted: false,
        handles: natives.map(({handle}) => handle),
        job: {grouped, kind, messages},
      };
    });
  }

  /**
   * Hands one serving start to the host. Its serving capacity stays charged until the host's promise settles, which
   * the binding registers before host code runs. A throw or rejection fails the stream.
   *
   * @param {Incoming} incoming
   */
  #serve(incoming) {
    /** @type {PromiseWithResolvers<void>} */
    const {promise: retired, resolve: release} = Promise.withResolvers();
    try {
      incoming.retainUntil(retired);
    } catch {
      // The stream ended before the host adopted it: there is nothing left to serve.
      release();
      return;
    }
    let served;
    try {
      served = Promise.resolve(this.#host.serve(new IncomingRequest(incoming)));
    } catch (error) {
      served = Promise.reject(error);
    }
    NativePump.#served(this.#weak, served, incoming, release);
  }

  /**
   * @param {WeakRef<NativePump>} weak
   * @param {Promise<void>} served
   * @param {Incoming} incoming
   * @param {() => void} release
   */
  static #served(weak, served, incoming, release) {
    served.then(
      () => {
        release();
        const pump = weak.deref();
        if (pump) pump.#schedule();
      },
      (error) => {
        void incoming.fail(2, new TextEncoder().encode("Local serving failure")).catch(noop);
        release();
        const pump = weak.deref();
        if (!pump) return;
        pump.#error(error);
        pump.#schedule();
      }
    );
  }

  /**
   * Classifies every check with the host's answers, or unavailable when it cannot answer them all.
   * @param {readonly NativeGossipDependencyCheck[]} checks
   */
  #check(checks) {
    if (checks.length === 0) return;
    let available = null;
    try {
      const answers = this.#host.checkDependencies(
        checks.map(({root, slot, peerId, topic, kind, payloadPresent, parentBlockHash}) => ({
          kind,
          parentBlockHash,
          payloadPresent,
          peerId,
          root,
          slot,
          topic,
        }))
      );
      // Every index is checked, since array methods skip the holes of a sparse array.
      const answered = Array.isArray(answers) && answers.length === checks.length;
      if (!answered || !checks.every((_, i) => typeof answers[i] === "boolean"))
        throw contractError("checkDependencies");
      available = answers;
    } catch (error) {
      this.#error(error);
    }
    for (const [i, {handle}] of checks.entries()) this.#runtime?.classifyGossip(handle, available?.[i] === true);
  }

  /**
   * Hands one job to the host. A throw, a rejection or the wrong verdicts ignore every message.
   * @param {Job} record
   */
  #validate(record) {
    const {job} = record;
    assert(job !== null);
    record.job = null;
    let verdicts;
    try {
      verdicts = Promise.resolve(this.#host.validate(job));
    } catch (error) {
      verdicts = Promise.reject(error);
    }
    NativePump.#validated(this.#weak, verdicts, record);
  }

  /**
   * @param {WeakRef<NativePump>} weak
   * @param {Promise<readonly Verdict[]>} verdicts
   * @param {Job} record
   */
  static #validated(weak, verdicts, record) {
    verdicts.then(
      (values) => {
        const pump = weak.deref();
        if (pump) pump.#verdicts(record, values);
      },
      (error) => {
        const pump = weak.deref();
        if (!pump) return;
        pump.#error(error);
        pump.#verdicts(record, null);
      }
    );
  }

  /**
   * Submits one verdict per message, in order; anything but one valid verdict per message ignores them all.
   * @param {Job} record
   * @param {unknown} values
   */
  #verdicts(record, values) {
    if (this.#stopped) return;
    const count = record.handles.length;
    const valid =
      Array.isArray(values) && values.length === count && record.handles.every((_, i) => VERDICTS.has(values[i]));
    if (values !== null && !valid) this.#error(contractError("validate"));
    for (let i = 0; i < count; i++) this.#runtime?.reportGossip(record.handles[i], valid ? values[i] : "ignore");
    this.#schedule();
  }

  /**
   * @param {WeakRef<NativePump>} weak
   * @param {number} started
   */
  static #burstEnd(weak, started) {
    const pump = weak.deref();
    if (!pump) return;
    const value = (performance.now() - started) / 1000;
    const burst = pump.#burst;
    burst.count++;
    burst.sum += value;
    for (let i = 0; i < BURST_BUCKETS.length; i++) if (value <= BURST_BUCKETS[i]) burst.buckets[i]++;
  }

  /**
   * The drain burst histogram, whose duration includes intervening event-loop work, and separate counters for
   * undelivered log records and failed log drains, in exposition format.
   */
  metrics() {
    const {buckets, sum, count} = this.#burst;
    const lines = [
      `# HELP ${BURST_NAME} Time from a native drain macrotask's start to the next setImmediate checkpoint, including the promise continuations it triggered`,
      `# TYPE ${BURST_NAME} histogram`,
    ];
    for (let i = 0; i < BURST_BUCKETS.length; i++)
      lines.push(`${BURST_NAME}_bucket{le="${BURST_BUCKETS[i]}"} ${buckets[i]}`);
    lines.push(`${BURST_NAME}_bucket{le="+Inf"} ${count}`, `${BURST_NAME}_sum ${sum}`, `${BURST_NAME}_count ${count}`);
    assert(this.#logs !== null);
    return `${lines.join("\n")}\n${this.#logs.metrics()}`;
  }
}
