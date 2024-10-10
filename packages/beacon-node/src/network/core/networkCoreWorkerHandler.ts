import path from "node:path";
import workerThreads from "node:worker_threads";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/dist/src/score/peer-score.js";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
import {ModuleThread, Thread, Worker, spawn} from "@chainsafe/threads";
import {PeerId, Secp256k1PeerId} from "@libp2p/interface";
import {exportToProtobuf} from "@libp2p/peer-id-factory";
import {routes} from "@lodestar/api";
import {BeaconConfig, chainConfigToJson} from "@lodestar/config";
import type {LoggerNode} from "@lodestar/logger/node";
import {ResponseIncoming, ResponseOutgoing} from "@lodestar/reqresp";
import {phase0} from "@lodestar/types";
import {Metrics} from "../../metrics/index.js";
import {AsyncIterableBridgeCaller, AsyncIterableBridgeHandler} from "../../util/asyncIterableToEvents.js";
import {peerIdFromString} from "../../util/peerId.js";
import {terminateWorkerThread, wireEventsOnMainThread} from "../../util/workerEvents.js";
import {NetworkEventBus, NetworkEventData, networkEventDirection} from "../events.js";
import {NetworkOptions} from "../options.js";
import {PeerAction, PeerScoreStats} from "../peers/index.js";
import {GetReqRespHandlerFn, IncomingRequestArgs, OutgoingRequestArgs} from "../reqresp/types.js";
import {CommitteeSubscription} from "../subnets/interface.js";
import {
  NetworkWorkerThreadEventType,
  ReqRespBridgeEventBus,
  ReqRespBridgeEventData,
  getReqRespBridgeReqEvents,
  getReqRespBridgeRespEvents,
  reqRespBridgeEventDirection,
} from "./events.js";
import {INetworkCore, MultiaddrStr, NetworkWorkerApi, NetworkWorkerData, PeerIdStr} from "./types.js";

// Worker constructor consider the path relative to the current working directory
const workerDir = process.env.NODE_ENV === "test" ? "../../../lib/network/core/" : "./";

export type WorkerNetworkCoreOpts = NetworkOptions & {
  metricsEnabled: boolean;
  peerStoreDir?: string;
  activeValidatorCount: number;
  genesisTime: number;
  initialStatus: phase0.Status;
};

export type WorkerNetworkCoreInitModules = {
  opts: WorkerNetworkCoreOpts;
  config: BeaconConfig;
  logger: LoggerNode;
  peerId: PeerId;
  events: NetworkEventBus;
  metrics: Metrics | null;
  getReqRespHandler: GetReqRespHandlerFn;
};

type WorkerNetworkCoreModules = WorkerNetworkCoreInitModules & {
  networkThreadApi: ModuleThread<NetworkWorkerApi>;
  worker: Worker;
};

const NETWORK_WORKER_EXIT_TIMEOUT_MS = 1000;
const NETWORK_WORKER_EXIT_RETRY_COUNT = 3;

/**
 * NetworkCore implementation using a Worker thread
 */
export class WorkerNetworkCore implements INetworkCore {
  private readonly reqRespBridgeReqCaller: AsyncIterableBridgeCaller<OutgoingRequestArgs, ResponseIncoming>;
  private readonly reqRespBridgeRespHandler: AsyncIterableBridgeHandler<IncomingRequestArgs, ResponseOutgoing>;
  private readonly reqRespBridgeEventBus = new ReqRespBridgeEventBus();

  constructor(private readonly modules: WorkerNetworkCoreModules) {
    // Get called from main thread to issue a ReqResp request, and emits event to worker
    this.reqRespBridgeReqCaller = new AsyncIterableBridgeCaller(getReqRespBridgeReqEvents(this.reqRespBridgeEventBus));
    // Handles ReqResp response from worker and calls async generator in main thread
    this.reqRespBridgeRespHandler = new AsyncIterableBridgeHandler(
      getReqRespBridgeRespEvents(this.reqRespBridgeEventBus),
      (data) => modules.getReqRespHandler(data.method)(data.req, peerIdFromString(data.peerId))
    );

    wireEventsOnMainThread<NetworkEventData>(
      NetworkWorkerThreadEventType.networkEvent,
      modules.events,
      modules.worker as unknown as workerThreads.Worker,
      modules.metrics,
      networkEventDirection
    );
    wireEventsOnMainThread<ReqRespBridgeEventData>(
      NetworkWorkerThreadEventType.reqRespBridgeEvents,
      this.reqRespBridgeEventBus,
      modules.worker as unknown as workerThreads.Worker,
      modules.metrics,
      reqRespBridgeEventDirection
    );

    Thread.errors(modules.networkThreadApi).subscribe((err) => {
      this.modules.logger.error("Network worker thread error", {}, err);
    });

    const {metrics} = modules;
    if (metrics) {
      metrics.networkWorkerHandler.reqRespBridgeReqCallerPending.addCollect(() => {
        metrics.networkWorkerHandler.reqRespBridgeReqCallerPending.set(this.reqRespBridgeReqCaller.pendingCount);
      });
    }
  }

  static async init(modules: WorkerNetworkCoreInitModules): Promise<WorkerNetworkCore> {
    const {opts, config, peerId} = modules;
    const {genesisTime, peerStoreDir, activeValidatorCount, localMultiaddrs, metricsEnabled, initialStatus} = opts;

    const workerData: NetworkWorkerData = {
      opts,
      chainConfigJson: chainConfigToJson(config),
      genesisValidatorsRoot: config.genesisValidatorsRoot,
      peerIdProto: exportToProtobuf(peerId as Secp256k1PeerId),
      localMultiaddrs,
      metricsEnabled,
      peerStoreDir,
      genesisTime,
      initialStatus,
      activeValidatorCount,
      loggerOpts: modules.logger.toOpts(),
    };

    const worker = new Worker(path.join(workerDir, "networkCoreWorker.js"), {
      workerData,
      /**
       * maxYoungGenerationSizeMb defaults to 152mb through the cli option defaults.
       * That default value was determined via https://github.com/ChainSafe/lodestar/issues/2115 and
       * should be tuned further as needed.  If we update network code and see substantial
       * difference in the quantity of garbage collected this should get updated.  A value that is
       * too low will result in too much GC time and a value that is too high causes increased mark
       * and sweep for some reason (which is much much slower than scavenge).  A marginally too high
       * number causes detrimental slowdown from increased variable lookup time.  Empirical evidence
       * showed that there is a pretty big window of "correct" values but we can always tune as
       * necessary
       */
      resourceLimits: {maxYoungGenerationSizeMb: opts.maxYoungGenerationSizeMb},
    } as ConstructorParameters<typeof Worker>[1]);

    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    const networkThreadApi = (await spawn<any>(worker, {
      // A Lodestar Node may do very expensive task at start blocking the event loop and causing
      // the initialization to timeout. The number below is big enough to almost disable the timeout
      timeout: 5 * 60 * 1000,
      // TODO: types are broken on spawn, which claims that `NetworkWorkerApi` does not satisfies its contrains
    })) as unknown as ModuleThread<NetworkWorkerApi>;

    return new WorkerNetworkCore({
      ...modules,
      networkThreadApi,
      worker,
    });
  }

  async close(): Promise<void> {
    this.modules.logger.debug("closing network core running in network worker");
    await this.getApi().close();
    this.modules.logger.debug("terminating network worker");
    await terminateWorkerThread({
      worker: this.getApi(),
      retryCount: NETWORK_WORKER_EXIT_RETRY_COUNT,
      retryMs: NETWORK_WORKER_EXIT_TIMEOUT_MS,
      logger: this.modules.logger,
    });
    this.modules.logger.debug("terminated network worker");
  }

  async test(): Promise<void> {
    return;
  }

  scrapeMetrics(): Promise<string> {
    return this.getApi().scrapeMetrics();
  }

  updateStatus(status: phase0.Status): Promise<void> {
    return this.getApi().updateStatus(status);
  }
  reStatusPeers(peers: PeerIdStr[]): Promise<void> {
    return this.getApi().reStatusPeers(peers);
  }
  reportPeer(peer: PeerIdStr, action: PeerAction, actionName: string): Promise<void> {
    return this.getApi().reportPeer(peer, action, actionName);
  }

  // TODO: Should this just be events? Do they need to report errors back?
  prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.getApi().prepareBeaconCommitteeSubnets(subscriptions);
  }
  prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.getApi().prepareSyncCommitteeSubnets(subscriptions);
  }
  subscribeGossipCoreTopics(): Promise<void> {
    return this.getApi().subscribeGossipCoreTopics();
  }
  unsubscribeGossipCoreTopics(): Promise<void> {
    return this.getApi().unsubscribeGossipCoreTopics();
  }

  // REST API queries

  getConnectedPeerCount(): Promise<number> {
    return this.getApi().getConnectedPeerCount();
  }
  getConnectedPeers(): Promise<PeerIdStr[]> {
    return this.getApi().getConnectedPeers();
  }
  getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    return this.getApi().getNetworkIdentity();
  }

  // ReqResp and gossip outgoing

  sendReqRespRequest(data: OutgoingRequestArgs): AsyncIterable<ResponseIncoming> {
    return this.reqRespBridgeReqCaller.getAsyncIterable(data);
  }
  publishGossip(topic: string, data: Uint8Array, opts?: PublishOpts): Promise<number> {
    return this.getApi().publishGossip(topic, data, opts);
  }

  // Debug

  connectToPeer(peer: PeerIdStr, multiaddr: MultiaddrStr[]): Promise<void> {
    return this.getApi().connectToPeer(peer, multiaddr);
  }
  disconnectPeer(peer: PeerIdStr): Promise<void> {
    return this.getApi().disconnectPeer(peer);
  }
  dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    return this.getApi().dumpPeers();
  }
  dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    return this.getApi().dumpPeer(peerIdStr);
  }
  dumpPeerScoreStats(): Promise<PeerScoreStats> {
    return this.getApi().dumpPeerScoreStats();
  }
  dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump> {
    return this.getApi().dumpGossipPeerScoreStats();
  }
  dumpDiscv5KadValues(): Promise<string[]> {
    return this.getApi().dumpDiscv5KadValues();
  }
  dumpMeshPeers(): Promise<Record<string, string[]>> {
    return this.getApi().dumpMeshPeers();
  }
  writeNetworkThreadProfile(durationMs: number, dirpath: string): Promise<string> {
    return this.getApi().writeProfile(durationMs, dirpath);
  }
  writeDiscv5Profile(durationMs: number, dirpath: string): Promise<string> {
    return this.getApi().writeDiscv5Profile(durationMs, dirpath);
  }
  writeNetworkHeapSnapshot(prefix: string, dirpath: string): Promise<string> {
    return this.getApi().writeHeapSnapshot(prefix, dirpath);
  }
  writeDiscv5HeapSnapshot(prefix: string, dirpath: string): Promise<string> {
    return this.getApi().writeDiscv5HeapSnapshot(prefix, dirpath);
  }

  private getApi(): ModuleThread<NetworkWorkerApi> {
    return this.modules.networkThreadApi;
  }
}
