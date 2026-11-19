import type {
  HostCapacity,
  IpEndpoint,
  NativeApplicationConfig,
  NativeHost,
  NativeIdentity,
  NativeNetwork,
  NativePeerAction,
  NativePeerObservation,
  NativePeerReportContext,
  NativePeerState,
  PeerIdStr,
} from "../../src/network.js";
import type {
  NativeBridge,
  NativeExchange,
  NativeGossipHandle,
  NativeGossipVerdict,
  NativeLogBatch,
  NativeRuntimeCloseResult,
} from "../../src/network-types.js";
export function initializeNativeNetworkRuntime(
  config: NativeApplicationConfig,
  onWorkAvailable: () => void,
  onPeers?: (events: readonly NativePeerObservation[]) => void
): NetworkTestRuntime;
export function createNativeNetwork(config: NativeApplicationConfig, host: NativeHost): NativeNetwork;
export function runtimeOf(network: NativeNetwork): (NativeBridge & Pick<NetworkTestRuntime, "getMetrics">) | undefined;

export interface NetworkTestRuntime
  extends Pick<
    NativeNetwork,
    | "limits"
    | "setLogLevel"
    | "request"
    | "applyIntent"
    | "updateStatus"
    | "getGossipDiagnostics"
    | "getPeerScores"
    | "disconnect"
  > {
  drainLogs(maxRecords?: number): NativeLogBatch;
  /** Prometheus text rendered on demand by the owner. Rejects with NetworkClosed once the owner stops. */
  getMetrics: NativeNetwork["metrics"];
  publishGossip: NativeNetwork["publish"];
  publicationCapacityWatch(token: string): boolean;
  commandCapacityWatch(token: string): boolean;
  /** A failed runtime cannot restart. The host must shut down the beacon node on terminal failure. */
  readonly closed: Promise<NativeRuntimeCloseResult>;
  readonly identity: NativeIdentity;
  /** One-shot connection attempt, retired on success or timeout. Use addDirectPeer for persistent membership. */
  connect(peerId: PeerIdStr, addresses: readonly IpEndpoint[], timeoutMs: bigint): Promise<void>;
  reStatusPeers: NativeNetwork["reStatus"];
  addDirectPeer(peerId: PeerIdStr, addresses: readonly IpEndpoint[]): Promise<void>;
  removeDirectPeer(peerId: PeerIdStr): Promise<boolean>;
  /** Settles bounded completions and delivers payloads under standing host capacity. */
  exchange(): NativeExchange;
  /** Replenishes the host allowance without scheduling delivery; call exchange when capacity recovers. */
  setCapacity(capacity: HostCapacity | null): void;
  reportGossip(handle: NativeGossipHandle, verdict: NativeGossipVerdict): void;
  classifyGossip(handle: NativeGossipHandle, available: boolean): void;
  notifyBlock(root: Uint8Array): void;
  dropQueuedGossip(): void;
  reportPeer(peerId: PeerIdStr, action: NativePeerAction, context?: NativePeerReportContext): void;
  close(): Promise<NativeRuntimeCloseResult>;
  observeIdentity(): NativeIdentity;
  observePeers(): {peers: NativePeerState[]; counts: {connected: number; relevant: number}};
}
