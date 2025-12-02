import {Identify} from "@libp2p/identify";
import {
  ComponentLogger,
  ConnectionGater,
  ConnectionProtector,
  ContentRouting,
  Libp2pEvents,
  Metrics,
  NodeInfo,
  PeerId,
  PeerRouting,
  PeerStore,
  PrivateKey,
  TypedEventTarget,
  Upgrader,
} from "@libp2p/interface";
import type {AddressManager, ConnectionManager, Registrar, TransportManager} from "@libp2p/interface-internal";
import type {Datastore} from "interface-datastore";
import {Libp2p as ILibp2p} from "libp2p";
import {
  AttesterSlashing,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  SingleAttestation,
  Slot,
  SlotRootHex,
  SubnetID,
  altair,
  capella,
  deneb,
  fulu,
  phase0,
} from "@lodestar/types";
import {BlockInputSource} from "../chain/blocks/blockInput/types.js";
import {CustodyConfig} from "../util/dataColumns.js";
import {PeerIdStr} from "../util/peerId.js";
import {BeaconBlocksByRootRequest, BlobSidecarsByRootRequest, DataColumnSidecarsByRootRequest} from "../util/types.js";
import {INetworkCorePublic} from "./core/types.js";
import {INetworkEventBus} from "./events.js";
import {GossipType} from "./gossip/interface.js";
import {PeerAction} from "./peers/index.js";
import {PeerSyncMeta} from "./peers/peersData.js";
import {PendingGossipsubMessage} from "./processor/types.js";

/**
 * The architecture of the network looks like so:
 * - core:
 *   - INetworkCore - This interface encapsulates all functionality from BaseNetwork, its meant to act as an wrapper that makes multiple implementations more simple
 *   - NetworkCore - This _implementation_ contains all libp2p and dependent modules
 *   - WorkerNetworkCore - This _implementation_ wraps a NetworkCore in a Worker thread
 * - INetwork - This interface extends INetworkCore and crucially allows for a connection to the BeaconChain module.
 */

export interface INetwork extends INetworkCorePublic {
  readonly peerId: PeerId;
  readonly custodyConfig: CustodyConfig;
  readonly closed: boolean;
  events: INetworkEventBus;

  getConnectedPeers(): PeerIdStr[];
  getConnectedPeerSyncMeta(peerId: PeerIdStr): PeerSyncMeta;
  getConnectedPeerCount(): number;
  isSubscribedToGossipCoreTopics(): boolean;
  reportPeer(peer: PeerIdStr, action: PeerAction, actionName: string): void;
  shouldAggregate(subnet: SubnetID, slot: Slot): boolean;
  reStatusPeers(peers: PeerIdStr[]): Promise<void>;
  searchUnknownSlotRoot(slotRoot: SlotRootHex, source: BlockInputSource, peer?: PeerIdStr): void;
  // ReqResp
  sendBeaconBlocksByRange(peerId: PeerIdStr, request: phase0.BeaconBlocksByRangeRequest): Promise<SignedBeaconBlock[]>;
  sendBeaconBlocksByRoot(peerId: PeerIdStr, request: BeaconBlocksByRootRequest): Promise<SignedBeaconBlock[]>;
  sendBlobSidecarsByRange(peerId: PeerIdStr, request: deneb.BlobSidecarsByRangeRequest): Promise<deneb.BlobSidecar[]>;
  sendBlobSidecarsByRoot(peerId: PeerIdStr, request: BlobSidecarsByRootRequest): Promise<deneb.BlobSidecar[]>;
  sendDataColumnSidecarsByRange(
    peerId: PeerIdStr,
    request: fulu.DataColumnSidecarsByRangeRequest
  ): Promise<fulu.DataColumnSidecar[]>;
  sendDataColumnSidecarsByRoot(
    peerId: PeerIdStr,
    request: DataColumnSidecarsByRootRequest
  ): Promise<fulu.DataColumnSidecar[]>;

  // Gossip
  publishBeaconBlock(signedBlock: SignedBeaconBlock): Promise<number>;
  publishBlobSidecar(blobSidecar: deneb.BlobSidecar): Promise<number>;
  publishBeaconAggregateAndProof(aggregateAndProof: SignedAggregateAndProof): Promise<number>;
  publishBeaconAttestation(attestation: SingleAttestation, subnet: SubnetID): Promise<number>;
  publishDataColumnSidecar(dataColumnSideCar: fulu.DataColumnSidecar): Promise<number>;
  publishVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<number>;
  publishBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): Promise<number>;
  publishProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<number>;
  publishAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<number>;
  publishSyncCommitteeSignature(signature: altair.SyncCommitteeMessage, subnet: SubnetID): Promise<number>;
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
  privateKey: PrivateKey;
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
