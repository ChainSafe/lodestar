import EventEmitter from "events";
import {PeerId} from "@libp2p/interface-peer-id";
import StrictEventEmitter from "strict-event-emitter-types";
import {exportToProtobuf} from "@libp2p/peer-id-factory";
import {
  createKeypairFromPeerId,
  ENR,
  ENRData,
  IDiscv5DiscoveryInputOptions,
  IKeypair,
  SignableENR,
} from "@chainsafe/discv5";
import {spawn, Thread, Worker} from "@chainsafe/threads";
import {chainConfigFromJson, chainConfigToJson, BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {Discv5WorkerApi, Discv5WorkerData} from "./types.js";

export type Discv5Opts = {
  peerId: PeerId;
  discv5: Omit<IDiscv5DiscoveryInputOptions, "metrics" | "searchInterval" | "enabled">;
  logger: Logger;
  config: BeaconConfig;
  metrics?: Metrics;
};

export type Discv5Events = {
  discovered: (enr: ENR) => void;
};

type Discv5WorkerStatus =
  | {status: "stopped"}
  | {status: "started"; workerApi: Discv5WorkerApi; subscription: {unsubscribe(): void}};

/**
 * Wrapper class abstracting the details of discv5 worker instantiation and message-passing
 */
export class Discv5Worker extends (EventEmitter as {new (): StrictEventEmitter<EventEmitter, Discv5Events>}) {
  private logger: Logger;
  private status: Discv5WorkerStatus;
  private keypair: IKeypair;

  constructor(private opts: Discv5Opts) {
    super();

    this.logger = opts.logger;
    this.status = {status: "stopped"};
    this.keypair = createKeypairFromPeerId(this.opts.peerId);
  }

  async start(): Promise<void> {
    if (this.status.status === "started") return;

    const workerData: Discv5WorkerData = {
      enr: (this.opts.discv5.enr as SignableENR).toObject(),
      peerIdProto: exportToProtobuf(this.opts.peerId),
      bindAddr: this.opts.discv5.bindAddr,
      config: this.opts.discv5,
      bootEnrs: this.opts.discv5.bootEnrs as string[],
      metrics: Boolean(this.opts.metrics),
      chainConfig: chainConfigFromJson(chainConfigToJson(this.opts.config)),
      genesisValidatorsRoot: this.opts.config.genesisValidatorsRoot,
    };
    const worker = new Worker("./worker.js", {workerData} as ConstructorParameters<typeof Worker>[1]);

    const workerApi = await spawn<Discv5WorkerApi>(worker, {
      // A Lodestar Node may do very expensive task at start blocking the event loop and causing
      // the initialization to timeout. The number below is big enough to almost disable the timeout
      timeout: 5 * 60 * 1000,
    });

    const subscription = workerApi.discovered().subscribe((enrObj) => this.onDiscovered(enrObj));

    this.status = {status: "started", workerApi, subscription};
  }

  async stop(): Promise<void> {
    if (this.status.status === "stopped") return;

    this.status.subscription.unsubscribe();
    await this.status.workerApi.close();
    await Thread.terminate((this.status.workerApi as unknown) as Thread);

    this.status = {status: "stopped"};
  }

  onDiscovered(obj: ENRData): void {
    const enr = this.decodeEnr(obj);
    if (enr) {
      this.emit("discovered", enr);
    }
  }

  async enr(): Promise<SignableENR> {
    if (this.status.status === "started") {
      const obj = await this.status.workerApi.enr();
      return new SignableENR(obj.kvs, obj.seq, this.keypair);
    } else {
      throw new Error("Cannot get enr before module is started");
    }
  }

  async setEnrValue(key: string, value: Uint8Array): Promise<void> {
    if (this.status.status === "started") {
      await this.status.workerApi.setEnrValue(key, value);
    } else {
      throw new Error("Cannot setEnrValue before module is started");
    }
  }

  async kadValues(): Promise<ENR[]> {
    if (this.status.status === "started") {
      return this.decodeEnrs(await this.status.workerApi.kadValues());
    } else {
      return [];
    }
  }

  async discoverKadValues(): Promise<void> {
    if (this.status.status === "started") {
      await this.status.workerApi.discoverKadValues();
    }
  }

  async findRandomNode(): Promise<ENR[]> {
    if (this.status.status === "started") {
      return this.decodeEnrs(await this.status.workerApi.findRandomNode());
    } else {
      return [];
    }
  }

  async metrics(): Promise<string> {
    if (this.status.status === "started") {
      return this.status.workerApi.metrics();
    } else {
      return "";
    }
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
