import fs from "node:fs";
import path from "node:path";
import {createFromProtobuf} from "@libp2p/peer-id-factory";
import {chainConfigFromJson, createBeaconConfig} from "@lodestar/config";
import {getNodeLogger} from "@lodestar/logger/node";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {collectNodeJSMetrics, RegistryMetricCreator} from "../../metrics/index.js";
import {AsyncIterableBridgeCaller, AsyncIterableBridgeHandler} from "../../util/asyncIterableToEvents.js";
import {Clock} from "../../util/clock.js";
import {wireEventsOnWorkerProcess} from "../../util/workerEvents.js";
import {getWorkerData} from "../../util/workerProcess.js";
import {WorkerApi} from "../../util/workerApi.js";
import {NetworkEventBus, NetworkEventData, networkEventDirection} from "../events.js";
import {peerIdToString} from "../../util/peerId.js";
import {profileNodeJS} from "../../util/profile.js";
import {getNetworkCoreWorkerMetrics} from "./metrics.js";
import {NetworkWorkerApi, NetworkWorkerData} from "./types.js";
import {NetworkCore} from "./networkCore.js";
import {
  NetworkWorkerThreadEventType,
  ReqRespBridgeEventBus,
  ReqRespBridgeEventData,
  getReqRespBridgeReqEvents,
  getReqRespBridgeRespEvents,
  reqRespBridgeEventDirection,
} from "./events.js";

/* eslint-disable no-console */

// TODO: move init code to reusable function
const exitSignals = ["SIGTERM", "SIGINT"] as NodeJS.Signals[];
for (const signal of exitSignals) {
  process.on(signal, () => {
    // TODO: Is there another way to achieve this?
    // Ignore exit signals to prevent prematurely shutting down child process
  });
}

process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("Unhandled Rejection worker process:", reason);
});

process.on("uncaughtException", (error) => {
  // eslint-disable-next-line no-console
  console.error("Uncaught Exception worker process:", error);
});

process.on("exit", () => console.log("child exited"));

// Cloned data from instantiation
const workerData = getWorkerData() as NetworkWorkerData;
const workerApi = new WorkerApi();
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
if (!workerData) throw Error("workerData must be defined");
if (!process.send) throw Error("process.send must be defined");

const config = createBeaconConfig(chainConfigFromJson(workerData.chainConfigJson), workerData.genesisValidatorsRoot);
const peerId = await createFromProtobuf(workerData.peerIdProto);
const DEFAULT_PROFILE_DURATION = SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000;

// TODO: Pass options from main thread for logging
// TODO: Logging won't be visible in file loggers
const logger = getNodeLogger(workerData.loggerOpts);

// Alive and consistency check
logger.info("libp2p worker started", {peer: peerIdToString(peerId)});

const abortController = new AbortController();

// Set up metrics, nodejs and discv5-specific
const metricsRegister = workerData.metricsEnabled ? new RegistryMetricCreator() : null;
if (metricsRegister) {
  const closeMetrics = collectNodeJSMetrics(metricsRegister, "network_worker_");
  abortController.signal.addEventListener("abort", closeMetrics, {once: true});
}

// Main event bus shared across the stack
const events = new NetworkEventBus();
const reqRespBridgeEventBus = new ReqRespBridgeEventBus();
const clock = new Clock({config, genesisTime: workerData.genesisTime, signal: abortController.signal});

// ReqResp event bridge
//
// The ReqRespHandler module handles app-level requests / responses from other peers,
// fetching state from the chain and database as needed.
//
// On the worker's side the ReqResp module will call the async generator when the stream
// is ready to send responses to the multiplexed libp2p stream.
//
// - libp2p inbound stream opened for reqresp method
// - request data fully streamed
// - ResResp handler called with request data and started
// - stream calls next() on handler
// - handler fetches block from DB, yields value
// - stream calls next() again
// - handler fetches block from DB, yields value
// (case a)
// - remote peer disconnects, stream aborted, calls return() on handler
// (case b)
// - handler has yielded all blocks, returns
// (case c)
// - handler encounters error, throws
new AsyncIterableBridgeHandler(getReqRespBridgeReqEvents(reqRespBridgeEventBus), (data) =>
  core.sendReqRespRequest(data)
);
const reqRespBridgeRespCaller = new AsyncIterableBridgeCaller(getReqRespBridgeRespEvents(reqRespBridgeEventBus));

// respBridgeCaller metrics
if (metricsRegister) {
  const networkCoreWorkerMetrics = getNetworkCoreWorkerMetrics(metricsRegister);
  networkCoreWorkerMetrics.reqRespBridgeRespCallerPending.addCollect(() => {
    networkCoreWorkerMetrics.reqRespBridgeRespCallerPending.set(reqRespBridgeRespCaller.pendingCount);
  });
}

const core = await NetworkCore.init({
  opts: workerData.opts,
  config,
  peerId,
  peerStoreDir: workerData.peerStoreDir,
  logger,
  metricsRegistry: metricsRegister,
  events,
  clock,
  getReqRespHandler: (method) => (req, peerId) =>
    reqRespBridgeRespCaller.getAsyncIterable({method, req, peerId: peerIdToString(peerId)}),
  activeValidatorCount: workerData.activeValidatorCount,
  initialStatus: workerData.initialStatus,
});

wireEventsOnWorkerProcess<NetworkEventData>(
  NetworkWorkerThreadEventType.networkEvent,
  events,
  workerApi,
  networkEventDirection
);
wireEventsOnWorkerProcess<ReqRespBridgeEventData>(
  NetworkWorkerThreadEventType.reqRespBridgeEvents,
  reqRespBridgeEventBus,
  workerApi,
  reqRespBridgeEventDirection
);

const libp2pWorkerApi: NetworkWorkerApi = {
  close: () => {
    abortController.abort();
    return core.close();
  },
  scrapeMetrics: () => core.scrapeMetrics(),

  updateStatus: (status) => core.updateStatus(status),

  prepareBeaconCommitteeSubnets: (subscriptions) => core.prepareBeaconCommitteeSubnets(subscriptions),
  prepareSyncCommitteeSubnets: (subscriptions) => core.prepareSyncCommitteeSubnets(subscriptions),
  reportPeer: (peer, action, actionName) => core.reportPeer(peer, action, actionName),
  reStatusPeers: (peers) => core.reStatusPeers(peers),
  subscribeGossipCoreTopics: () => core.subscribeGossipCoreTopics(),
  unsubscribeGossipCoreTopics: () => core.unsubscribeGossipCoreTopics(),

  // sendReqRespRequest - handled via events with AsyncIterableBridgeHandler
  publishGossip: (topic, data, opts) => core.publishGossip(topic, data, opts),

  // Debug

  getNetworkIdentity: () => core.getNetworkIdentity(),
  getConnectedPeers: () => core.getConnectedPeers(),
  getConnectedPeerCount: () => core.getConnectedPeerCount(),
  connectToPeer: (peer, multiaddr) => core.connectToPeer(peer, multiaddr),
  disconnectPeer: (peer) => core.disconnectPeer(peer),
  dumpPeers: () => core.dumpPeers(),
  dumpPeer: (peerIdStr) => core.dumpPeer(peerIdStr),
  dumpPeerScoreStats: () => core.dumpPeerScoreStats(),
  dumpGossipPeerScoreStats: () => core.dumpGossipPeerScoreStats(),
  dumpDiscv5KadValues: () => core.dumpDiscv5KadValues(),
  dumpMeshPeers: () => core.dumpMeshPeers(),
  writeProfile: async (durationMs = DEFAULT_PROFILE_DURATION, dirpath = ".") => {
    const profile = await profileNodeJS(durationMs);
    const filePath = path.join(dirpath, `network_thread_${new Date().toISOString()}.cpuprofile`);
    fs.writeFileSync(filePath, profile);
    return filePath;
  },
};

workerApi.expose(libp2pWorkerApi);
