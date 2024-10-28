import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
import {routes} from "@lodestar/api";
import {ResponseIncoming} from "@lodestar/reqresp";
import {phase0} from "@lodestar/types";
import {LoggerNodeOpts} from "@lodestar/logger/node";
import {NetworkOptions} from "../options.js";
import {CommitteeSubscription} from "../subnets/interface.js";
import {PeerAction, PeerScoreStats} from "../peers/index.js";
import {OutgoingRequestArgs} from "../reqresp/types.js";

export type MultiaddrStr = string;
export type PeerIdStr = string;

// Interface shared by main Network class, and all backends
export interface INetworkCorePublic {
  // Peer manager control
  prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void>;
  prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void>;
  // reportPeer - Different interface depending on the backend

  // REST API getters
  getNetworkIdentity(): Promise<routes.node.NetworkIdentity>;

  // Gossip control
  subscribeGossipCoreTopics(): Promise<void>;
  unsubscribeGossipCoreTopics(): Promise<void>;

  // Debug
  connectToPeer(peer: PeerIdStr, multiaddr: MultiaddrStr[]): Promise<void>;
  disconnectPeer(peer: PeerIdStr): Promise<void>;
  dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]>;
  dumpPeer(peerIdStr: PeerIdStr): Promise<routes.lodestar.LodestarNodePeer | undefined>;
  dumpPeerScoreStats(): Promise<PeerScoreStats>;
  dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump>;
  dumpDiscv5KadValues(): Promise<string[]>;
  dumpMeshPeers(): Promise<Record<string, string[]>>;
}

/**
 * Contains core network functionality (libp2p and dependent modules)
 *
 * All properties/methods should be async to allow for a worker implementation
 */
export interface INetworkCore extends INetworkCorePublic {
  // Sync method
  reportPeer(peer: PeerIdStr, action: PeerAction, actionName: string): void;
  reStatusPeers(peers: PeerIdStr[]): Promise<void>;

  // TODO: Duplicated methods with INetwork interface
  getConnectedPeers(): Promise<PeerIdStr[]>;
  getConnectedPeerCount(): Promise<number>;

  /** Chain must push status updates to the network core */
  updateStatus(status: phase0.Status): Promise<void>;

  /** Opens stream to handle ReqResp outgoing request */
  sendReqRespRequest(data: OutgoingRequestArgs): AsyncIterable<ResponseIncoming>;
  /** Publish gossip message to peers */
  publishGossip(topic: string, data: Uint8Array, opts?: PublishOpts): Promise<number>;

  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;
  writeNetworkThreadProfile(durationMs: number, dirpath: string): Promise<string>;
  writeDiscv5Profile(durationMs: number, dirpath: string): Promise<string>;
  writeNetworkHeapSnapshot(prefix: string, dirpath: string): Promise<string>;
  writeDiscv5HeapSnapshot(prefix: string, dirpath: string): Promise<string>;
}

/**
 * libp2p worker contructor (start-up) data
 */
export type NetworkWorkerData = {
  // TODO: Review if NetworkOptions is safe for passing
  opts: NetworkOptions;
  chainConfigJson: Record<string, string>;
  genesisValidatorsRoot: Uint8Array;
  genesisTime: number;
  activeValidatorCount: number;
  initialStatus: phase0.Status;
  peerIdProto: Uint8Array;
  localMultiaddrs: string[];
  metricsEnabled: boolean;
  peerStoreDir?: string;
  loggerOpts: LoggerNodeOpts;
};

/**
 * API exposed by the libp2p worker
 */
export type NetworkWorkerApi = INetworkCorePublic & {
  // To satisfy the constraint of `ModuleThread` type
  // biome-ignore lint/suspicious/noExplicitAny:
  [string: string]: (...args: any[]) => Promise<any> | any;
  // Async method through worker boundary
  reportPeer(peer: PeerIdStr, action: PeerAction, actionName: string): Promise<void>;
  reStatusPeers(peers: PeerIdStr[]): Promise<void>;

  // TODO: Duplicated methods with INetwork interface
  getConnectedPeers(): Promise<PeerIdStr[]>;
  getConnectedPeerCount(): Promise<number>;
  updateStatus(status: phase0.Status): Promise<void>;

  // sendReqRespRequest - implemented via events
  publishGossip(topic: string, data: Uint8Array, opts?: PublishOpts): Promise<number>;

  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;
  writeProfile(durationMs: number, dirpath: string): Promise<string>;
  writeDiscv5Profile(durationMs: number, dirpath: string): Promise<string>;

  // TODO: ReqResp outgoing
  // TODO: ReqResp incoming
};
