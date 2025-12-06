import EventEmitter from "node:events";
import path from "node:path";
import {Worker} from "node:worker_threads";
import {fileURLToPath} from "node:url";
import {privateKeyToProtobuf} from "@libp2p/crypto/keys";
import {PrivateKey} from "@libp2p/interface";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {ENR, ENRData, SignableENR} from "@chainsafe/enr";
import {BeaconConfig, chainConfigFromJson, chainConfigToJson} from "@lodestar/config";
import {LoggerNode} from "@lodestar/logger/node";
import {NetworkCoreMetrics} from "../core/metrics.js";
import {Discv5WorkerData, Discv5WorkerMessage, Discv5WorkerResponse, LodestarDiscv5Opts} from "./types.js";

// Resolve worker path relative to this file
// In dev/test mode: running from src/, worker is in lib/
// In production: running from lib/, worker is in same directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath =
  process.env.NODE_ENV === "test"
    ? path.join(__dirname, "../../../lib/network/discv5/worker.js")
    : path.join(__dirname, "worker.js");

export type Discv5Opts = {
  privateKey: PrivateKey;
  discv5: LodestarDiscv5Opts;
  logger: LoggerNode;
  config: BeaconConfig;
  genesisTime: number;
  metrics?: NetworkCoreMetrics;
};

export type Discv5Events = {
  discovered: (enr: ENR) => void;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/**
 * Wrapper class abstracting the details of discv5 worker instantiation and message-passing
 */
export class Discv5Worker extends (EventEmitter as {new (): StrictEventEmitter<EventEmitter, Discv5Events>}) {
  private readonly worker: Worker;
  private readonly opts: Discv5Opts;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private nextId = 0;
  private closed = false;

  constructor(opts: Discv5Opts, worker: Worker) {
    super();
    this.opts = opts;
    this.worker = worker;

    this.worker.on("message", this.handleWorkerMessage);
    this.worker.on("error", (error) => {
      opts.logger.error("Discv5 worker error", {}, error);
    });
  }

  static async init(opts: Discv5Opts): Promise<Discv5Worker> {
    const workerData: Discv5WorkerData = {
      enr: opts.discv5.enr,
      privateKeyProto: privateKeyToProtobuf(opts.privateKey),
      bindAddrs: opts.discv5.bindAddrs,
      config: opts.discv5.config ?? {},
      bootEnrs: opts.discv5.bootEnrs,
      metrics: Boolean(opts.metrics),
      chainConfig: chainConfigFromJson(chainConfigToJson(opts.config)),
      genesisValidatorsRoot: opts.config.genesisValidatorsRoot,
      loggerOpts: opts.logger.toOpts(),
      genesisTime: opts.genesisTime,
    };

    const worker = new Worker(workerPath, {workerData});

    // Wait for worker to be ready (it starts discv5 on initialization)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Discv5 worker initialization timeout"));
      }, 5 * 60 * 1000);

      worker.once("online", () => {
        clearTimeout(timeout);
        resolve();
      });

      worker.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    return new Discv5Worker(opts, worker);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    await this.sendRequest({type: "close", id: this.nextId++});
    await this.worker.terminate();
  }

  onDiscovered(obj: ENRData): void {
    const enr = this.decodeEnr(obj);
    if (enr) {
      this.emit("discovered", enr);
    }
  }

  async enr(): Promise<SignableENR> {
    const response = (await this.sendRequest({type: "enr", id: this.nextId++})) as {enr: {kvs: Map<string, Uint8Array>; seq: bigint}};
    return new SignableENR(response.enr.kvs, response.enr.seq, this.opts.privateKey.raw);
  }

  setEnrValue(key: string, value: Uint8Array): Promise<void> {
    return this.sendRequest({type: "setEnrValue", id: this.nextId++, key, value}) as Promise<void>;
  }

  async kadValues(): Promise<ENR[]> {
    const response = (await this.sendRequest({type: "kadValues", id: this.nextId++})) as {enrs: ENRData[]};
    return this.decodeEnrs(response.enrs);
  }

  discoverKadValues(): Promise<void> {
    return this.sendRequest({type: "discoverKadValues", id: this.nextId++}) as Promise<void>;
  }

  async findRandomNode(): Promise<ENR[]> {
    const response = (await this.sendRequest({type: "findRandomNode", id: this.nextId++})) as {enrs: ENRData[]};
    return this.decodeEnrs(response.enrs);
  }

  async scrapeMetrics(): Promise<string> {
    const response = (await this.sendRequest({type: "scrapeMetrics", id: this.nextId++})) as {metrics: string};
    return response.metrics;
  }

  async writeProfile(durationMs: number, dirpath: string): Promise<string> {
    const response = (await this.sendRequest({type: "writeProfile", id: this.nextId++, durationMs, dirpath})) as {path: string};
    return response.path;
  }

  async writeHeapSnapshot(prefix: string, dirpath: string): Promise<string> {
    const response = (await this.sendRequest({type: "writeHeapSnapshot", id: this.nextId++, prefix, dirpath})) as {path: string};
    return response.path;
  }

  private sendRequest(message: Discv5WorkerMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(message.id, {resolve, reject});
      this.worker.postMessage(message);
    });
  }

  private handleWorkerMessage = (response: Discv5WorkerResponse): void => {
    // Handle discovered events (no id, broadcast)
    if (response.type === "discovered") {
      this.onDiscovered(response.enr);
      return;
    }

    // Handle request/response messages
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      this.opts.logger.warn("Received response for unknown request", {id: response.id, type: response.type});
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.type === "error") {
      const error = new Error(response.error.message);
      if (response.error.stack) error.stack = response.error.stack;
      pending.reject(error);
    } else {
      pending.resolve(response);
    }
  };

  private decodeEnrs(objs: ENRData[]): ENR[] {
    const enrs: ENR[] = [];
    for (const obj of objs) {
      const enr = this.decodeEnr(obj);
      if (enr) {
        enrs.push(enr);
      }
    }
    return enrs;
  }

  private decodeEnr(obj: ENRData): ENR | null {
    this.opts.metrics?.discv5.decodeEnrAttemptCount.inc(1);
    return new ENR(obj.kvs, obj.seq, obj.signature);
  }
}
