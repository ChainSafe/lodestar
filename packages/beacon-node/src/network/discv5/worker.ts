import worker from "node:worker_threads";
import {privateKeyFromProtobuf} from "@libp2p/crypto/keys";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {Multiaddr, multiaddr} from "@multiformats/multiaddr";
import {Discv5, Discv5EventEmitter} from "@chainsafe/discv5";
import {ENR, SignableENR} from "@chainsafe/enr";
import {createBeaconConfig} from "@lodestar/config";
import {getNodeLogger} from "@lodestar/logger/node";
import {Gauge} from "@lodestar/utils";
import {RegistryMetricCreator} from "../../metrics/index.js";
import {collectNodeJSMetrics} from "../../metrics/nodeJsMetrics.js";
import {Clock} from "../../util/clock.js";
import {ProfileThread, profileThread, writeHeapSnapshot} from "../../util/profile.js";
import {Discv5WorkerData, Discv5WorkerMessage, Discv5WorkerResponse} from "./types.js";
import {ENRRelevance, enrRelevance} from "./utils.js";

// This discv5 worker will start discv5 on initialization (there is no `start` function to call)
// A consumer _should_ call `close` before terminating the worker to cleanly exit discv5 before destroying the thread
// A `setEnrValue` function is also provided to update the host ENR key-values shared in the discv5 network.

// Cloned data from instatiation
const workerData = worker.workerData as Discv5WorkerData;
if (!workerData) throw Error("workerData must be defined");
const parentPort = worker.parentPort;
if (!parentPort) throw Error("parentPort must be defined");

const logger = getNodeLogger(workerData.loggerOpts);

// Set up metrics, nodejs and discv5-specific
let metricsRegistry: RegistryMetricCreator | undefined;
let enrRelevanceMetric: Gauge<{status: string}> | undefined;
let closeMetrics: (() => void) | undefined;
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
}) as Discv5 & Discv5EventEmitter;

// Load boot enrs
for (const bootEnr of workerData.bootEnrs) {
  discv5.addEnr(bootEnr);
}

/** Define a new clock */
const abortController = new AbortController();
const clock = new Clock({config, genesisTime: workerData.genesisTime, signal: abortController.signal});

const onDiscovered = (enr: ENR): void => {
  const status = enrRelevance(enr, config, clock);
  enrRelevanceMetric?.inc({status});
  if (status === ENRRelevance.relevant) {
    // Send discovered ENR to main thread
    const response: Discv5WorkerResponse = {
      type: "discovered",
      enr: enr.toObject(),
    };
    parentPort.postMessage(response);
  }
};
discv5.addListener("discovered", onDiscovered);

// Discv5 will now begin accepting request/responses
await discv5.start();

// Handle messages from main thread
parentPort.on("message", async (message: Discv5WorkerMessage) => {
  try {
    let response: Discv5WorkerResponse;

    switch (message.type) {
      case "enr": {
        response = {
          type: "enr",
          id: message.id,
          enr: discv5.enr.toObject(),
        };
        break;
      }
      case "setEnrValue": {
        discv5.enr.set(message.key, message.value);
        response = {
          type: "setEnrValue",
          id: message.id,
        };
        break;
      }
      case "kadValues": {
        response = {
          type: "kadValues",
          id: message.id,
          enrs: discv5.kadValues().map((enr: ENR) => enr.toObject()),
        };
        break;
      }
      case "discoverKadValues": {
        discv5.kadValues().map(onDiscovered);
        response = {
          type: "discoverKadValues",
          id: message.id,
        };
        break;
      }
      case "findRandomNode": {
        const enrs = await discv5.findRandomNode();
        response = {
          type: "findRandomNode",
          id: message.id,
          enrs: enrs.map((enr: ENR) => enr.toObject()),
        };
        break;
      }
      case "scrapeMetrics": {
        response = {
          type: "scrapeMetrics",
          id: message.id,
          metrics: (await metricsRegistry?.metrics()) ?? "",
        };
        break;
      }
      case "writeProfile": {
        const path = await profileThread(ProfileThread.DISC5, message.durationMs, message.dirpath);
        response = {
          type: "writeProfile",
          id: message.id,
          path,
        };
        break;
      }
      case "writeHeapSnapshot": {
        const path = await writeHeapSnapshot(message.prefix, message.dirpath);
        response = {
          type: "writeHeapSnapshot",
          id: message.id,
          path,
        };
        break;
      }
      case "close": {
        closeMetrics?.();
        discv5.removeListener("discovered", onDiscovered);
        abortController.abort();
        await discv5.stop();
        response = {
          type: "close",
          id: message.id,
        };
        break;
      }
      default:
        throw new Error(`Unknown message type: ${(message as Discv5WorkerMessage).type}`);
    }

    parentPort.postMessage(response);
  } catch (e) {
    const response: Discv5WorkerResponse = {
      type: "error",
      id: (message as Discv5WorkerMessage).id,
      error: {message: (e as Error).message, stack: (e as Error).stack},
    };
    parentPort.postMessage(response);
  }
});

const logData: Record<string, string> = {
  peerId: peerId.toString(),
  initialENR: workerData.enr,
};

if (workerData.bindAddrs.ip4) logData.bindAddr4 = workerData.bindAddrs.ip4;
if (workerData.bindAddrs.ip6) logData.bindAddr6 = workerData.bindAddrs.ip6;

logger.info("discv5 worker started", logData);
