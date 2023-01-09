import worker from "worker_threads";
import {createFromProtobuf} from "@libp2p/peer-id-factory";
import {multiaddr} from "@multiformats/multiaddr";
import {expose} from "@chainsafe/threads/worker";
import {Observable, Subject} from "@chainsafe/threads/observable";
import {createKeypairFromPeerId, Discv5, ENR, IDiscv5Metrics} from "@chainsafe/discv5";
import {createDiscv5Metrics} from "../../metrics/metrics/discv5.js";
import {RegistryMetricCreator} from "../../metrics/index.js";
import {collectNodeJSMetrics} from "../../metrics/nodeJsMetrics.js";
import {Discv5WorkerApi, Discv5WorkerData} from "./types.js";

// Cloned data from instatiation
const workerData = worker.workerData as Discv5WorkerData;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
if (!workerData) throw Error("workerData must be defined");

const metricsRegistry = new RegistryMetricCreator();
collectNodeJSMetrics(metricsRegistry, "discv5_worker_");
const metrics = createDiscv5Metrics(metricsRegistry);

const peerId = await createFromProtobuf(workerData.peerIdProto);
const keypair = createKeypairFromPeerId(peerId);

const discv5 = Discv5.create({
  enr: workerData.enrStr,
  peerId,
  multiaddr: multiaddr(workerData.bindAddr),
  config: workerData.config,
  metrics: workerData.metrics
    ? ((metrics as unknown) as {
        [K in keyof typeof metrics]: IDiscv5Metrics[keyof IDiscv5Metrics];
      })
    : undefined,
});

for (const bootEnr of workerData.bootEnrs) {
  discv5.addEnr(bootEnr);
}
/** Used to push discovered ENRs */
const subject = new Subject<Uint8Array>();

const onDiscovered = (enr: ENR): void => subject.next(enr.encode());
discv5.addListener("discovered", onDiscovered);

await discv5.start();

const module: Discv5WorkerApi = {
  async enrBuf(): Promise<Uint8Array> {
    return discv5.enr.encode(keypair.privateKey);
  },
  async setEnrValue(key: string, value: Uint8Array): Promise<void> {
    discv5.enr.set(key, value);
  },
  async kadValuesBuf(): Promise<Uint8Array[]> {
    return discv5.kadValues().map((enr) => enr.encode());
  },
  async findRandomNodeBuf(): Promise<Uint8Array[]> {
    return (await discv5.findRandomNode()).map((enr) => enr.encode());
  },
  discoveredBuf() {
    return Observable.from(subject);
  },
  async metrics(): Promise<string> {
    return await metricsRegistry.metrics();
  },
  async close() {
    discv5.removeListener("discovered", onDiscovered);
    subject.complete();
    await discv5.stop();
  },
};

expose(module);
