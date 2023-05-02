import worker from "node:worker_threads";
import {createFromProtobuf} from "@libp2p/peer-id-factory";
import {multiaddr} from "@multiformats/multiaddr";
import {Gauge} from "prom-client";
import {expose} from "@chainsafe/threads/worker";
import {Observable, Subject} from "@chainsafe/threads/observable";
import {createKeypairFromPeerId, Discv5, ENR, ENRData, SignableENR, SignableENRData} from "@chainsafe/discv5";
import {createBeaconConfig} from "@lodestar/config";
import {RegistryMetricCreator} from "../../metrics/index.js";
import {collectNodeJSMetrics} from "../../metrics/nodeJsMetrics.js";
import {Discv5WorkerApi, Discv5WorkerData} from "./types.js";
import {enrRelevance, ENRRelevance} from "./utils.js";

// This discv5 worker will start discv5 on initialization (there is no `start` function to call)
// A consumer _should_ call `close` before terminating the worker to cleanly exit discv5 before destroying the thread
// A `setEnrValue` function is also provided to update the host ENR key-values shared in the discv5 network.

// Cloned data from instatiation
const workerData = worker.workerData as Discv5WorkerData;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
if (!workerData) throw Error("workerData must be defined");

// Set up metrics, nodejs and discv5-specific
let metricsRegistry: RegistryMetricCreator | undefined;
let enrRelevanceMetric: Gauge<"status"> | undefined;
if (workerData.metrics) {
  metricsRegistry = new RegistryMetricCreator();
  collectNodeJSMetrics(metricsRegistry, "discv5_worker_");

  // add enr relevance metric
  enrRelevanceMetric = metricsRegistry.gauge<"status">({
    name: "lodestar_discv5_discovered_status_total_count",
    help: "Total count of status results of enrRelevance() function",
    labelNames: ["status"],
  });
}

const peerId = await createFromProtobuf(workerData.peerIdProto);
const keypair = createKeypairFromPeerId(peerId);

const config = createBeaconConfig(workerData.chainConfig, workerData.genesisValidatorsRoot);

// Initialize discv5
const discv5 = Discv5.create({
  enr: new SignableENR(workerData.enr.kvs, workerData.enr.seq, keypair),
  peerId,
  multiaddr: multiaddr(workerData.bindAddr),
  config: workerData.config,
  metricsRegistry,
});

// Load boot enrs
for (const bootEnr of workerData.bootEnrs) {
  discv5.addEnr(bootEnr);
}

/** Used to push discovered ENRs */
const subject = new Subject<ENRData>();

const onDiscovered = (enr: ENR): void => {
  const status = enrRelevance(enr, config);
  enrRelevanceMetric?.inc({status});
  if (status === ENRRelevance.relevant) {
    subject.next(enr.toObject());
  }
};
discv5.addListener("discovered", onDiscovered);

// Discv5 will now begin accepting request/responses
await discv5.start();

const module: Discv5WorkerApi = {
  async enr(): Promise<SignableENRData> {
    return discv5.enr.toObject();
  },
  async setEnrValue(key: string, value: Uint8Array): Promise<void> {
    discv5.enr.set(key, value);
  },
  async kadValues(): Promise<ENRData[]> {
    return discv5.kadValues().map((enr) => enr.toObject());
  },
  async discoverKadValues(): Promise<void> {
    discv5.kadValues().map(onDiscovered);
  },
  async findRandomNode(): Promise<ENRData[]> {
    return (await discv5.findRandomNode()).map((enr) => enr.toObject());
  },
  discovered() {
    return Observable.from(subject);
  },
  async metrics(): Promise<string> {
    return (await metricsRegistry?.metrics()) ?? "";
  },
  async close() {
    discv5.removeListener("discovered", onDiscovered);
    subject.complete();
    await discv5.stop();
  },
};

expose(module);
