import worker from "node:worker_threads";
import path from "node:path";
import fs from "node:fs";
import {Multiaddr, multiaddr} from "@multiformats/multiaddr";
import {expose} from "@chainsafe/threads/worker";
import {Observable, Subject} from "@chainsafe/threads/observable";
import {Discv5} from "@chainsafe/discv5";
import {ENR, ENRData, SignableENR, SignableENRData} from "@chainsafe/enr";
import {privateKeyFromProtobuf} from "@libp2p/crypto/keys";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {createBeaconConfig} from "@lodestar/config";
import {getNodeLogger} from "@lodestar/logger/node";
import {Gauge} from "@lodestar/utils";
import {RegistryMetricCreator} from "../../metrics/index.js";
import {collectNodeJSMetrics} from "../../metrics/nodeJsMetrics.js";
import {profileNodeJS, writeHeapSnapshot} from "../../util/profile.js";
import {Discv5WorkerApi, Discv5WorkerData} from "./types.js";
import {enrRelevance, ENRRelevance} from "./utils.js";

// This discv5 worker will start discv5 on initialization (there is no `start` function to call)
// A consumer _should_ call `close` before terminating the worker to cleanly exit discv5 before destroying the thread
// A `setEnrValue` function is also provided to update the host ENR key-values shared in the discv5 network.

// Cloned data from instatiation
const workerData = worker.workerData as Discv5WorkerData;
if (!workerData) throw Error("workerData must be defined");

const logger = getNodeLogger(workerData.loggerOpts);

// Set up metrics, nodejs and discv5-specific
let metricsRegistry: RegistryMetricCreator | undefined;
let enrRelevanceMetric: Gauge<{status: string}> | undefined;
let closeMetrics: () => void | undefined;
if (workerData.metrics) {
  metricsRegistry = new RegistryMetricCreator();
  closeMetrics = collectNodeJSMetrics(metricsRegistry, "discv5_worker_");

  // add enr relevance metric
  enrRelevanceMetric = metricsRegistry.gauge<{status: string}>({
    name: "lodestar_discv5_discovered_status_total_count",
    help: "Total count of status results of enrRelevance() function",
    labelNames: ["status"],
  });
}

const privateKey = privateKeyFromProtobuf(workerData.privateKeyProto);
const peerId = peerIdFromPrivateKey(privateKey);

const config = createBeaconConfig(workerData.chainConfig, workerData.genesisValidatorsRoot);

// Initialize discv5
const discv5 = Discv5.create({
  enr: SignableENR.decodeTxt(workerData.enr, privateKey.raw),
  privateKey,
  bindAddrs: {
    ip4: (workerData.bindAddrs.ip4 ? multiaddr(workerData.bindAddrs.ip4) : undefined) as Multiaddr,
    ip6: workerData.bindAddrs.ip6 ? multiaddr(workerData.bindAddrs.ip6) : undefined,
  },
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
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore wtf?
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
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore wtf?
    discv5.kadValues().map(onDiscovered);
  },
  async findRandomNode(): Promise<ENRData[]> {
    return (await discv5.findRandomNode()).map((enr) => enr.toObject());
  },
  discovered() {
    return Observable.from(subject);
  },
  async scrapeMetrics(): Promise<string> {
    return (await metricsRegistry?.metrics()) ?? "";
  },
  writeProfile: async (durationMs: number, dirpath: string) => {
    const profile = await profileNodeJS(durationMs);
    const filePath = path.join(dirpath, `discv5_thread_${new Date().toISOString()}.cpuprofile`);
    fs.writeFileSync(filePath, profile);
    return filePath;
  },
  writeHeapSnapshot: async (prefix: string, dirpath: string) => {
    return writeHeapSnapshot(prefix, dirpath);
  },
  async close() {
    closeMetrics?.();
    discv5.removeListener("discovered", onDiscovered);
    subject.complete();
    await discv5.stop();
  },
};

expose(module);

const logData: Record<string, string> = {
  peerId: peerId.toString(),
  initialENR: workerData.enr,
};

if (workerData.bindAddrs.ip4) logData.bindAddr4 = workerData.bindAddrs.ip4;
if (workerData.bindAddrs.ip6) logData.bindAddr6 = workerData.bindAddrs.ip6;

logger.info("discv5 worker started", logData);
