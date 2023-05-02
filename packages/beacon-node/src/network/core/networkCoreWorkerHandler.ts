import {PublishResult} from "@libp2p/interface-pubsub";
import {exportToProtobuf} from "@libp2p/peer-id-factory";
import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {routes} from "@lodestar/api";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/dist/src/score/peer-score.js";
import {phase0} from "@lodestar/types";
import {ResponseIncoming, ResponseOutgoing} from "@lodestar/reqresp";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
import {spawn, Thread, Worker} from "@chainsafe/threads";
import {BeaconConfig, chainConfigToJson} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {AsyncIterableBridgeCaller, AsyncIterableBridgeHandler} from "../../util/asyncIterableToEvents.js";
import {IncomingRequestArgs, OutgoingRequestArgs, GetReqRespHandlerFn} from "../reqresp/types.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {CommitteeSubscription} from "../subnets/interface.js";
import {PeerAction, PeerScoreStats} from "../peers/index.js";
import {NetworkOptions} from "../options.js";
import {NetworkWorkerApi, NetworkWorkerData, INetworkCore} from "./types.js";
import {getReqRespBridgeReqEvents, getReqRespBridgeRespEvents} from "./events.js";

export type WorkerNetworkCoreOpts = NetworkOptions & {
  metrics: boolean;
  peerStoreDir?: string;
  activeValidatorCount: number;
  genesisTime: number;
  initialStatus: phase0.Status;
};

export type WorkerNetworkCoreInitModules = {
  opts: WorkerNetworkCoreOpts;
  config: BeaconConfig;
  logger: Logger;
  peerId: PeerId;
  events: NetworkEventBus;
  getReqRespHandler: GetReqRespHandlerFn;
};

type WorkerNetworkCoreModules = WorkerNetworkCoreInitModules & {
  workerApi: NetworkWorkerApi;
};

/**
 * NetworkCore implementation using a Worker thread
 */
export class WorkerNetworkCore implements INetworkCore {
  private readonly reqRespBridgeReqCaller: AsyncIterableBridgeCaller<OutgoingRequestArgs, ResponseIncoming>;
  private readonly reqRespBridgeRespHandler: AsyncIterableBridgeHandler<IncomingRequestArgs, ResponseOutgoing>;

  constructor(private readonly modules: WorkerNetworkCoreModules) {
    const {events} = modules;

    // Get called from main thread to issue a ReqResp request, and emits event to worker
    this.reqRespBridgeReqCaller = new AsyncIterableBridgeCaller(getReqRespBridgeReqEvents(events));
    // Handles ReqResp response from worker and calls async generator in main thread
    this.reqRespBridgeRespHandler = new AsyncIterableBridgeHandler(getReqRespBridgeRespEvents(events), (data) =>
      modules.getReqRespHandler(data.method)(data.req, data.peerId)
    );
  }

  static async init(modules: WorkerNetworkCoreInitModules): Promise<WorkerNetworkCore> {
    const {opts, config, peerId, events} = modules;
    const {genesisTime, peerStoreDir, activeValidatorCount, localMultiaddrs, metrics, initialStatus} = opts;

    const workerData: NetworkWorkerData = {
      opts,
      chainConfigJson: chainConfigToJson(config),
      genesisValidatorsRoot: config.genesisValidatorsRoot,
      peerIdProto: exportToProtobuf(peerId),
      localMultiaddrs,
      metrics,
      peerStoreDir,
      genesisTime,
      initialStatus,
      activeValidatorCount,
    };

    const worker = new Worker("./worker.js", {workerData} as ConstructorParameters<typeof Worker>[1]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerApi = (await spawn<any>(worker, {
      // A Lodestar Node may do very expensive task at start blocking the event loop and causing
      // the initialization to timeout. The number below is big enough to almost disable the timeout
      timeout: 5 * 60 * 1000,
      // TODO: types are broken on spawn, which claims that `NetworkWorkerApi` does not satifies its contrains
    })) as unknown as NetworkWorkerApi;

    workerApi.pendingGossipsubMessage().subscribe((data) => events.emit(NetworkEvent.pendingGossipsubMessage, data));

    return new WorkerNetworkCore({
      ...modules,
      workerApi,
    });
  }

  async close(): Promise<void> {
    await this.getApi().close();
    await Thread.terminate(this.modules.workerApi as unknown as Thread);
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
  reStatusPeers(peers: PeerId[]): Promise<void> {
    return this.getApi().reStatusPeers(peers);
  }
  reportPeer(peer: PeerId, action: PeerAction, actionName: string): Promise<void> {
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
  getConnectedPeers(): Promise<PeerId[]> {
    return this.getApi().getConnectedPeers();
  }
  getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    return this.getApi().getNetworkIdentity();
  }

  // ReqResp and gossip outgoing

  sendReqRespRequest(data: OutgoingRequestArgs): AsyncIterable<ResponseIncoming> {
    return this.reqRespBridgeReqCaller.getAsyncIterable(data);
  }
  publishGossip(topic: string, data: Uint8Array, opts?: PublishOpts): Promise<PublishResult> {
    return this.getApi().publishGossip(topic, data, opts);
  }

  // Debug

  connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void> {
    return this.getApi().connectToPeer(peer, multiaddr);
  }
  disconnectPeer(peer: PeerId): Promise<void> {
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

  private getApi(): NetworkWorkerApi {
    return this.modules.workerApi;
  }
}
