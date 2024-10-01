import {Libp2p as ILibp2p} from "libp2p";
import {
  Libp2pEvents,
  ComponentLogger,
  NodeInfo,
  ConnectionProtector,
  ConnectionGater,
  ContentRouting,
  TypedEventTarget,
  Metrics,
  PeerId,
  PeerRouting,
  PeerStore,
  Upgrader,
} from "@libp2p/interface";
import type {AddressManager, ConnectionManager, Registrar, TransportManager} from "@libp2p/interface-internal";
import type {Datastore} from "interface-datastore";
import {Identify} from "@chainsafe/libp2p-identify";
import {
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  SignedBeaconBlock,
  Slot,
  SlotRootHex,
  altair,
  capella,
  deneb,
  phase0,
  peerdas,
} from "@lodestar/types";
import {PeerIdStr} from "../util/peerId.js";
import {CustodyConfig} from "../util/dataColumns.js";
import {INetworkEventBus} from "./events.js";
import {INetworkCorePublic} from "./core/types.js";
import {GossipType} from "./gossip/interface.js";
import {PendingGossipsubMessage} from "./processor/types.js";
import {PeerAction} from "./peers/index.js";
import {NodeId} from "./subnets/interface.js";

export type WithBytes<T> = {data: T; bytes: Uint8Array};
export type WithOptionalBytes<T> = {data: T; bytes: Uint8Array | null};

/**
 * The architecture of the network looks like so:
 * - core:
 *   - INetworkCore - This interface encapsulates all functionality from BaseNetwork, its meant to act as an wrapper that makes multiple implementations more simple
 *   - NetworkCore - This _implementation_ contains all libp2p and dependent modules
 *   - WorkerNetworkCore - This _implementation_ wraps a NetworkCore in a Worker thread
 * - INetwork - This interface extends INetworkCore and crucially allows for a connection to the BeaconChain module.
 */

export interface INetwork extends INetworkCorePublic {
  readonly nodeId: NodeId;
  readonly peerId: PeerId;
  readonly custodyConfig: CustodyConfig;
  readonly closed: boolean;
  events: INetworkEventBus;

  getConnectedPeers(): PeerIdStr[];
  getConnectedPeerCustody(peerId: PeerIdStr): number[];
  getConnectedPeerClientAgent(peerId: PeerIdStr): string;
  getConnectedPeerCount(): number;
  isSubscribedToGossipCoreTopics(): boolean;
  reportPeer(peer: PeerIdStr, action: PeerAction, actionName: string): void;
  shouldAggregate(subnet: number, slot: Slot): boolean;
  reStatusPeers(peers: PeerIdStr[]): Promise<void>;
  searchUnknownSlotRoot(slotRoot: SlotRootHex, peer?: PeerIdStr): void;
  // ReqResp
  sendBeaconBlocksByRange(
    peerId: PeerIdStr,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<WithBytes<SignedBeaconBlock>[]>;
  sendBeaconBlocksByRoot(
    peerId: PeerIdStr,
    request: phase0.BeaconBlocksByRootRequest
  ): Promise<WithBytes<SignedBeaconBlock>[]>;
  sendBlobSidecarsByRange(peerId: PeerIdStr, request: deneb.BlobSidecarsByRangeRequest): Promise<deneb.BlobSidecar[]>;
  sendBlobSidecarsByRoot(peerId: PeerIdStr, request: deneb.BlobSidecarsByRootRequest): Promise<deneb.BlobSidecar[]>;
  sendDataColumnSidecarsByRange(
    peerId: PeerIdStr,
    request: peerdas.DataColumnSidecarsByRangeRequest
  ): Promise<peerdas.DataColumnSidecar[]>;
  sendDataColumnSidecarsByRoot(
    peerId: PeerIdStr,
    request: peerdas.DataColumnSidecarsByRootRequest
  ): Promise<peerdas.DataColumnSidecar[]>;

  // Gossip
  publishBeaconBlock(signedBlock: SignedBeaconBlock): Promise<number>;
  publishBlobSidecar(blobSidecar: deneb.BlobSidecar): Promise<number>;
  publishDataColumnSidecar(dataColumnSideCar: peerdas.DataColumnSidecar): Promise<number>;
  publishBeaconAggregateAndProof(aggregateAndProof: phase0.SignedAggregateAndProof): Promise<number>;
  publishBeaconAttestation(attestation: phase0.Attestation, subnet: number): Promise<number>;
  publishVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<number>;
  publishBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): Promise<number>;
  publishProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<number>;
  publishAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): Promise<number>;
  publishSyncCommitteeSignature(signature: altair.SyncCommitteeMessage, subnet: number): Promise<number>;
  publishContributionAndProof(contributionAndProof: altair.SignedContributionAndProof): Promise<number>;
  publishLightClientFinalityUpdate(update: LightClientFinalityUpdate): Promise<number>;
  publishLightClientOptimisticUpdate(update: LightClientOptimisticUpdate): Promise<number>;

  // Debug
  dumpGossipQueue(gossipType: GossipType): Promise<PendingGossipsubMessage[]>;
  writeNetworkThreadProfile(durationMs: number, dirpath: string): Promise<string>;
  writeDiscv5Profile(durationMs: number, dirpath: string): Promise<string>;
  writeNetworkHeapSnapshot(prefix: string, dirpath: string): Promise<string>;
  writeDiscv5HeapSnapshot(prefix: string, dirpath: string): Promise<string>;
}

export type LodestarComponents = {
  peerId: PeerId;
  nodeInfo: NodeInfo;
  logger: ComponentLogger;
  events: TypedEventTarget<Libp2pEvents>;
  addressManager: AddressManager;
  peerStore: PeerStore;
  upgrader: Upgrader;
  registrar: Registrar;
  connectionManager: ConnectionManager;
  transportManager: TransportManager;
  connectionGater: ConnectionGater;
  contentRouting: ContentRouting;
  peerRouting: PeerRouting;
  datastore: Datastore;
  connectionProtector?: ConnectionProtector;
  metrics?: Metrics;
};

export type Libp2p = ILibp2p<{components: LodestarComponents; identify: Identify}>;
