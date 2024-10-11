import EventEmitter from "node:events";
import {privateKeyToProtobuf} from "@libp2p/crypto/keys";
import {PrivateKey} from "@libp2p/interface";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {ENR, ENRData, SignableENR} from "@chainsafe/enr";
import {spawn, Thread, Worker} from "@chainsafe/threads";
import {chainConfigFromJson, chainConfigToJson, BeaconConfig} from "@lodestar/config";
import {LoggerNode} from "@lodestar/logger/node";
import {NetworkCoreMetrics} from "../core/metrics.js";
import {Discv5WorkerApi, Discv5WorkerData, LodestarDiscv5Opts} from "./types.js";

export type Discv5Opts = {
  privateKey: PrivateKey;
  discv5: LodestarDiscv5Opts;
  logger: LoggerNode;
  config: BeaconConfig;
  metrics?: NetworkCoreMetrics;
};

export type Discv5Events = {
  discovered: (enr: ENR) => void;
};

/**
 * Wrapper class abstracting the details of discv5 worker instantiation and message-passing
 */
export class Discv5Worker extends (EventEmitter as {new (): StrictEventEmitter<EventEmitter, Discv5Events>}) {
  private readonly subscription: {unsubscribe: () => void};
  private closed = false;

  constructor(
    private readonly opts: Discv5Opts,
    private readonly workerApi: Discv5WorkerApi
  ) {
    super();

    this.subscription = workerApi.discovered().subscribe((enrObj) => this.onDiscovered(enrObj));
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
    };
    const worker = new Worker("./worker.js", {workerData} as ConstructorParameters<typeof Worker>[1]);

    const workerApi = await spawn<Discv5WorkerApi>(worker, {
      // A Lodestar Node may do very expensive task at start blocking the event loop and causing
      // the initialization to timeout. The number below is big enough to almost disable the timeout
      timeout: 5 * 60 * 1000,
    });

    return new Discv5Worker(opts, workerApi);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    this.subscription.unsubscribe();
    await this.workerApi.close();
    await Thread.terminate(this.workerApi as unknown as Thread);
  }

  onDiscovered(obj: ENRData): void {
    const enr = this.decodeEnr(obj);
    if (enr) {
      this.emit("discovered", enr);
    }
  }

  async enr(): Promise<SignableENR> {
    const obj = await this.workerApi.enr();
    return new SignableENR(obj.kvs, obj.seq, this.opts.privateKey.raw);
  }

  setEnrValue(key: string, value: Uint8Array): Promise<void> {
    return this.workerApi.setEnrValue(key, value);
  }

  async kadValues(): Promise<ENR[]> {
    return this.decodeEnrs(await this.workerApi.kadValues());
  }

  discoverKadValues(): Promise<void> {
    return this.workerApi.discoverKadValues();
  }

  async findRandomNode(): Promise<ENR[]> {
    return this.decodeEnrs(await this.workerApi.findRandomNode());
  }

  scrapeMetrics(): Promise<string> {
    return this.workerApi.scrapeMetrics();
  }

  async writeProfile(durationMs: number, dirpath: string): Promise<string> {
    return this.workerApi.writeProfile(durationMs, dirpath);
  }

  async writeHeapSnapshot(prefix: string, dirpath: string): Promise<string> {
    return this.workerApi.writeHeapSnapshot(prefix, dirpath);
  }

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
