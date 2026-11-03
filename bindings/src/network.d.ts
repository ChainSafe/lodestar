import type {BeaconConfig} from "./state-transition.js";

/** Canonical unprefixed base58btc secp256k1 identity multihash, equal to libp2p PeerId.toString(). */
export type PeerIdStr = string;

export type NetworkFork = "phase0" | "altair" | "bellatrix" | "capella" | "deneb" | "electra" | "fulu" | "gloas";

/** IPv4 uses four address bytes; IPv6 uses sixteen and excludes IPv4-mapped addresses. */
export type IpEndpoint =
  | {family: 4; address: Uint8Array; port: number}
  | {family: 6; address: Uint8Array; port: number};

export interface AdvertisedEndpoints {
  ip4?: Uint8Array;
  /** Sixteen IPv6 address bytes; IPv4-mapped addresses are invalid. */
  ip6?: Uint8Array;
  udp?: number;
  udp6?: number;
  quic?: number;
  quic6?: number;
}

export interface NetworkStatus {
  forkDigest: Uint8Array;
  finalizedRoot: Uint8Array;
  finalizedEpoch: bigint;
  headRoot: Uint8Array;
  headSlot: bigint;
  /** Required from startup when Fulu is scheduled, including before its activation. */
  earliestAvailableSlot: bigint | null;
}

export interface NetworkMetadata {
  sequenceNumber: bigint;
  attnets: Uint8Array;
  syncnets: number;
  custodyGroupCount: bigint | null;
}

export type NetworkStatusUpdate = Omit<NetworkStatus, "forkDigest">;

export interface NativeLocalState {
  status: NetworkStatusUpdate;
  metadata: NetworkMetadata & {custodyGroupCount: bigint};
}

export interface NativeForkEntry {
  digest: Uint8Array;
  fork: NetworkFork;
}

export interface NativeDiscoveryConfig {
  /** IPv6 listeners accept only IPv6; IPv4 and IPv6 listeners may share a port. */
  bind: IpEndpoint | readonly IpEndpoint[];
  sequenceNumber: bigint;
  bootstrapEnrs: readonly Uint8Array[];
  /** Initial IP/UDP hints do not disable learning. QUIC uses its fixed or bound port. */
  advertisement: Pick<AdvertisedEndpoints, "ip4" | "ip6" | "udp" | "udp6"> | null;
  /** Explicit operator overrides. An IP also fixes UDP to the supplied or bound port. */
  fixed: AdvertisedEndpoints;
}

export interface NativeGossipStartupPolicy {
  /** Total host execution allowance. Uses the native default when omitted. */
  hostItems?: number;
  hostBytes?: number;
  /** Maximum simultaneous messages per kind, further bounded by its resource share. */
  topicConcurrency?: number;
  /** Absolute active-frame lifetime. Large payloads share their first recipient's deadline; progress never extends it. */
  activeSendTimeoutMs?: bigint;
  /** Distinct large payloads per kind, shared across recipients. */
  activeSendItems?: Readonly<Partial<Record<NativeTopicKind, number>>>;
  /** Absolute lifetime of an incomplete frame larger than the private receive buffer. */
  largeFrameTimeoutMs?: bigint;
  /** Shared pool capacity, in multiples of 4096. Frames consume pages only as bytes arrive. */
  receiveBufferBytes?: number;
}

export type NativeTopicKind =
  | "beacon_block"
  | "beacon_aggregate_and_proof"
  | "beacon_attestation"
  | "proposer_slashing"
  | "attester_slashing"
  | "voluntary_exit"
  | "sync_committee_contribution_and_proof"
  | "sync_committee"
  | "light_client_finality_update"
  | "light_client_optimistic_update"
  | "bls_to_execution_change"
  | "blob_sidecar"
  | "data_column_sidecar"
  | "execution_payload"
  | "payload_attestation_message"
  | "execution_payload_bid"
  | "proposer_preferences";

export interface NativeRuntimeConfig {
  activeValidatorCount: number;
  identitySecretKey: Uint8Array;
  /** IPv6 listeners accept only IPv6; IPv4 and IPv6 listeners may share a port. */
  bind: IpEndpoint | readonly IpEndpoint[];
  local: NativeLocalState;
  discovery: NativeDiscoveryConfig | null;
  /** Unix genesis time in seconds. Native advances slots and expires duties independently of the JS event loop. */
  genesisTime: bigint;
  subscriptions?: {
    subscribeAllSubnets: boolean;
    slotsToSubscribeBeforeAggregatorDuty: number;
    targetGroupPeers: number;
  };
  gossipPolicy?: NativeGossipStartupPolicy;
}

export interface NativeIdentity {
  peerId: PeerIdStr;
  localEndpoint: IpEndpoint;
  localEndpoints: readonly IpEndpoint[];
  localMultiaddr: Uint8Array;
  localEnr: Uint8Array | null;
  metadata: NativeLocalState["metadata"];
}

export type NativeLogLevel = "error" | "warn" | "info" | "debug" | "off";

export interface NativeLogRecord {
  level: Exclude<NativeLogLevel, "off">;
  scope: string;
  message: string;
  timestampMs: number;
}

export interface NativeResources {
  /** Steady peer target, strictly below maxPeers to admit locally selected trials. */
  targetPeers: number;
  maxPeers: number;
  /** Concurrent inbound peers per IPv4 address or IPv6 /64, 1 to 256. Uses the native default when omitted. */
  inboundPeersPerSourceMax?: number;
  /** Uses the native default when omitted. */
  receiveBudgetBytes?: number;
  /** Uses the native default when omitted. */
  nativeBudgetBytes?: number;
  /** Uses the native default when omitted. */
  bridgeBudgetBytes?: number;
}

export interface NativeApplicationConfig extends NativeRuntimeConfig {
  /** Bounded lifecycle logs for blocks and a stable 1/64 column sample. Defaults to false. */
  traceGossip?: boolean;
  /** Native exporter. Disabled by default. Owns bounded capture/replay and a dedicated thread. */
  xray?: {
    /** Filesystem Unix socket or numeric IP:port. */
    address: string;
    /** When true, initialization blocks for up to 30 seconds waiting for the collector. */
    waitForAttach: boolean;
  };
  /** Startup copies the derived network settings; this instance need not outlive initialization. */
  beaconConfig: BeaconConfig;
  resources: NativeResources;
  transport?: {
    /** Initial congestion window, 1 to 64 packets. Uses the native default when omitted. */
    initialCongestionWindowPackets?: number;
    /** Maximum received datagrams per owner turn, 1 to 256. Uses the native default when omitted. */
    receiveDatagramsPerTurn?: number;
  };
  identify: {agentVersion: string; protocolVersion: string};
  serveLightClients: boolean;
  /** The threshold native records are kept at from initialization, until setLogLevel selects another. */
  logLevel: NativeLogLevel;
  /**
   * Native peer cache directory, 1 to 1024 UTF-8 bytes. The caller must prevent concurrent modification by other runtimes
   * or processes. Missing or invalid cache files give a cold start. Omit to disable persistence.
   */
  peerStoreDir?: string;
}

/** Sparse local changes; native derives fork subscriptions, metadata and peer demand. */
export interface NativeLocalIntent {
  status?: NetworkStatusUpdate;
  coreTopics?: boolean;
  custodyGroupCount?: bigint;
  /** Fold validator duties by slot into 64-bit subnet masks; aggregators must be a subset of subnets.
   * At most four epochs of rows; native checks the current/next epoch horizon and discards expired duties.
   */
  attesters?: readonly {slot: number; subnets: bigint; aggregators: bigint}[];
  /** Inclusive duty slot; the subscription expires at the following epoch boundary. */
  syncCommittees?: readonly {subnet: number; untilSlot: number}[];
}

export interface NativePeerScores {
  observedMonoMs: bigint;
  observedUnixMs: bigint;
  peers: {identity: PeerIdStr; score: number; gossipScore: number; scoreAtMs: bigint}[];
}

export type NativeProtocolId =
  | "/ipfs/id/1.0.0"
  | "/meshsub/1.2.0"
  | "/meshsub/1.1.0"
  | "/meshsub/1.0.0"
  | "/eth2/beacon_chain/req/status/1/ssz_snappy"
  | "/eth2/beacon_chain/req/status/2/ssz_snappy"
  | "/eth2/beacon_chain/req/goodbye/1/ssz_snappy"
  | "/eth2/beacon_chain/req/ping/1/ssz_snappy"
  | "/eth2/beacon_chain/req/metadata/1/ssz_snappy"
  | "/eth2/beacon_chain/req/metadata/2/ssz_snappy"
  | "/eth2/beacon_chain/req/metadata/3/ssz_snappy"
  | NativeRequestProtocolId;

export type NativeRequestProtocolId =
  | "/eth2/beacon_chain/req/beacon_blocks_by_range/2/ssz_snappy"
  | "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy"
  | "/eth2/beacon_chain/req/blob_sidecars_by_range/1/ssz_snappy"
  | "/eth2/beacon_chain/req/blob_sidecars_by_root/1/ssz_snappy"
  | "/eth2/beacon_chain/req/data_column_sidecars_by_range/1/ssz_snappy"
  | "/eth2/beacon_chain/req/data_column_sidecars_by_root/1/ssz_snappy"
  | "/eth2/beacon_chain/req/beacon_blocks_by_head/1/ssz_snappy"
  | "/eth2/beacon_chain/req/light_client_bootstrap/1/ssz_snappy"
  | "/eth2/beacon_chain/req/light_client_updates_by_range/1/ssz_snappy"
  | "/eth2/beacon_chain/req/light_client_finality_update/1/ssz_snappy"
  | "/eth2/beacon_chain/req/light_client_optimistic_update/1/ssz_snappy"
  | "/eth2/beacon_chain/req/execution_payload_envelopes_by_range/1/ssz_snappy"
  | "/eth2/beacon_chain/req/execution_payload_envelopes_by_root/1/ssz_snappy";

export type NativePeerAction = "fatal" | "low_tolerance" | "mid_tolerance" | "high_tolerance";
export type NativeDisconnectReason =
  | "host"
  | "shutdown"
  | "transport_closed"
  | "capacity"
  | "incompatible_fork"
  | "future_head"
  | "finalized_mismatch"
  | "missing_availability"
  | "invalid_status"
  | "invalid_metadata"
  | "remote_goodbye"
  | "health_timeout"
  | "reputation"
  | "banned"
  | "count_pruning"
  | "gossip_unavailable"
  | "gossip_send_timeout"
  | "health_error";
export interface NativeConnection {
  index: number;
  generation: number;
}
/** Transport evidence copied when the work was observed. Null means mixed or unknown source paths. */
export interface NativePeerOrigin {
  readonly connection: NativeConnection;
  readonly endpoint: IpEndpoint | null;
}
export interface NativePeerReportContext {
  readonly origin?: NativePeerOrigin | null;
  readonly reason?:
    | "host"
    | "gossip_validation"
    | "gossip_import"
    | "gossip_receive_timeout"
    | "reqresp_protocol"
    | "reqresp_response";
}
export interface NativePeerState {
  identity: PeerIdStr;
  connection: NativeConnection | null;
  direction: "inbound" | "outbound";
  endpoint: IpEndpoint;
  relevant: boolean;
  disconnectReason: NativeDisconnectReason | null;
  status: NetworkStatus | null;
  metadata: NetworkMetadata | null;
  identify: {agent: string | null; protocolVersion: string | null; protocols: NativeProtocolId[]} | null;
  statusAtMs: bigint;
  metadataAtMs: bigint;
  custodyGroups: number[] | null;
  samplingGroups: number[] | null;
  connectedAtMs: bigint;
  direct: boolean;
  score: number;
  scoreAtMs: bigint;
  banUntilMs: bigint;
  goodbyeUntilMs: bigint;
  redialUntilMs: bigint;
}
/** Delivered in owner order. A close applies only to its connection generation. */
export type NativePeerObservation =
  | {type: "ready" | "updated"; state: NativePeerState}
  | {
      type: "closed";
      connection: NativeConnection;
      identity: PeerIdStr;
      reason: NativeDisconnectReason;
    };

export interface NativeRequestOptions {
  expectedChunks?: number;
  /** Integer milliseconds, 1..60000. Default: 5000. */
  negotiationTimeoutMs?: number;
  /** Integer milliseconds, 1..60000. Default: 5000. */
  requestTimeoutMs?: number;
  /**
   * Absolute response lifetime including host holds. Integer milliseconds, 1..60000. Default: 60000.
   * Transfer starts with 10000 ms of credit. Each completed successful chunk earns 1000 ms per MiB
   * of decoded payload, capped at 10000 ms of remaining credit and this absolute limit.
   * Host holds pause transfer credit; partial chunks earn nothing.
   */
  responseTimeoutMs?: number;
}
export interface NativeResponseChunk {
  data: Uint8Array;
  fork: NetworkFork | null;
  protocol: NativeRequestProtocolId;
  /** Origin captured when this response was received, retained after request or connection retirement. */
  origin: NativePeerOrigin;
}
export type NativeRequestPhase = "negotiation" | "request" | "response";
export type NativeRequestRejection =
  | "disconnected"
  | "protocol_disabled"
  | "invalid_request"
  | "invalid_request_options"
  | "too_many_requests"
  | "transport";
export type NativeRequestFailure =
  | "timeout"
  | "host_timeout"
  | "quota_timeout"
  | "cancelled"
  | "negotiation_rejected"
  | "negotiation_failed"
  | "invalid_response"
  | "too_many_chunks"
  | "empty_response"
  | "unknown_context"
  | "peer_error"
  | "connection_closed"
  | "stream_closed"
  | "transport";
export type NativeRequestError = Error &
  (
    | {code: "NetworkRequestRejected"; reason: NativeRequestRejection}
    | {code: "NetworkRequestRejected"; reason: "local_capacity"; capacityToken: string}
    | {
        code: "NetworkRequestFailed";
        reason: NativeRequestFailure;
        phase: NativeRequestPhase | null;
        origin: NativePeerOrigin | null;
        /** Native already recorded this fault against the peer. */
        peerFault: "protocol" | "non_completion" | null;
        detail: string | null;
        context: Uint8Array | null;
        peerStatus: number | null;
        peerMessage: Uint8Array | null;
      }
    | {code: "NetworkClosed"}
    | {code: "NetworkRequestBusy"}
  );
export type NativeIncomingFailure =
  | "timeout"
  | "host_timeout"
  | "quota_timeout"
  | "cancelled"
  | "connection_closed"
  | "stream_closed"
  | "transport";

/** Operational request errors. Malformed arguments and allocation failures retain their existing specific errors. */
export type NativeIncomingError = Error &
  (
    | {code: "NetworkBridgeFull"}
    | {code: "NetworkIncomingBusy"}
    | {code: "NetworkIncomingClosed"}
    | {
        code: "NetworkIncomingRejected";
        reason:
          | "invalid_context"
          | "unknown_fork"
          | "chunk_too_large"
          | "chunk_too_small"
          | "too_many_chunks"
          | "invalid_error";
      }
    | {code: "NetworkIncomingFailed"; failure: NativeIncomingFailure}
    | {code: "NetworkClosed"}
  );

export interface NativeGossipPublishOptions {
  /** Shortens the native queue lifetime. Integer milliseconds, 1..86400000. */
  maxQueueMs?: number;
  allowZeroPeers?: boolean;
  ignoreDuplicate?: boolean;
  flood?: boolean;
}
export interface NativeGossipPublishResult {
  /** Recipients whose send queues accepted the message. */
  queued: number;
  /** Recipients whose send queues refused the message. */
  pressured: number;
  /** Selected recipients: queued + pressured + unavailable. */
  selected: number;
  /** Selected recipients without an available gossip stream. */
  unavailable: number;
  duplicate: boolean;
}

export type NetworkGossipPublishFailed =
  | (Error & {
      code: "NetworkGossipPublishFailed";
      reason:
        | "unknown_topic"
        | "payload_too_small"
        | "payload_too_large"
        | "compress_failed"
        | "expired"
        | "resource_exhausted"
        | "duplicate"
        | "no_peers_subscribed_to_topic";
    })
  | (Error & {
      code: "NetworkGossipPublishFailed";
      reason: "admission_full";
      capacityToken: string;
    });

export interface NativeGossipTopicDiagnostic {
  index: number;
  topic: string;
  subscribed: boolean;
  weight: number;
  meshDeliveryActivationMs: bigint;
}
export interface NativeGossipTopicScoreDiagnostic {
  index: number;
  inMesh: boolean;
  meshMember: boolean;
  graftTimeMs: bigint;
  meshTimeMs: bigint;
  firstMessageDeliveries: number;
  meshMessageDeliveries: number;
  meshFailurePenalty: number;
  invalidMessageDeliveries: number;
  weights: {p1: number; p2: number; p3: number; p3b: number; p4: number};
}
export interface NativeGossipPeerDiagnostic {
  identity: PeerIdStr;
  ip: Uint8Array;
  connected: boolean;
  outboundReady: boolean;
  expireAtMs: bigint;
  score: number;
  appScore: number;
  behaviourPenalty: number;
  weights: {p5: number; p6: number; p7: number};
  topics: NativeGossipTopicScoreDiagnostic[];
}
/** Each page is copied from one owner turn. Cursors traverse at most 512 retained peer slots. */
export interface NativeGossipDiagnosticsPage {
  observedMonoMs: bigint;
  observedUnixMs: bigint;
  nextCursor: number | null;
  topics: NativeGossipTopicDiagnostic[];
  peers: NativeGossipPeerDiagnostic[];
}

export type Verdict = "accept" | "reject" | "ignore";

/**
 * A failed close carries the owner's terminal error, also when a requested close was already underway.
 * Host delivery failures are reported separately through `NativeHost.failed`.
 */
export type CloseResult = {readonly reason: "requested"} | {readonly reason: "failed"; readonly error: Error};

/** Resource limits and publication lifetime resolved at initialization. */
export interface NativeResolvedLimits {
  readonly peerCapacity: number;
  readonly incomingCapacity: number;
  /** Shortest configured slot duration, also the maximum lifetime of queued publications. */
  readonly publicationMaxWaitMs: number;
}

export interface GossipMessage {
  readonly attestationData: string | null;
  readonly slot: bigint | null;
  readonly peerId: PeerIdStr;
  readonly connection: NativeConnection;
  readonly endpoint: IpEndpoint | null;
  readonly topic: string;
  readonly id: Uint8Array;
  readonly data: Uint8Array;
  readonly receivedAtUnixMs: number;
}

/** One message, or one compatible attestation group validated together. */
export interface GossipJob {
  readonly kind: NativeTopicKind;
  readonly grouped: boolean;
  readonly messages: readonly GossipMessage[];
}

/** Unverified gossip metadata used only for bounded dependency recovery, never consensus validation. */
export interface DependencyCheck {
  readonly kind: NativeTopicKind;
  readonly payloadPresent: boolean;
  readonly parentBlockHash: Uint8Array | null;
  readonly root: Uint8Array;
  readonly slot: bigint;
  readonly peerId: PeerIdStr;
  readonly topic: string;
}

/**
 * A serving start. Its serving capacity stays charged until the stream closes and the promise `serve` returned
 * settles. At most one ready() or respond() call may be pending.
 */
export interface IncomingRequest {
  readonly peerId: PeerIdStr;
  readonly connection: NativeConnection;
  readonly protocol: NativeRequestProtocolId;
  readonly data: Uint8Array;
  /** Stream and response obligations ended; host work may remain. */
  readonly closed: Promise<void>;
  /** Before producing the first chunk, wait for native readiness and bridge capacity for a maximum-sized chunk. */
  ready(): Promise<void>;
  /** Copies the chunk. Resolves when native stops borrowing it and reserves capacity for the next chunk. */
  respond(data: Uint8Array, context: NativeForkEntry | null): Promise<void>;
  finish(): Promise<void>;
  /** Accepts standard error codes 1–3 or custom codes 128–255, with at most 256 message bytes. */
  fail(status: number, message: Uint8Array): Promise<void>;
  cancel(): Promise<void>;
}

/** Host validation readiness. Native owns execution limits and retained serving leases. */
export interface HostCapacity {
  /** Native still delivers urgent gossip while validation is backpressured. */
  gossipValidation: "ready" | "backpressured";
}

/**
 * The consumer of one network's delivered work. Each macrotask hands over one bounded batch without awaiting
 * asynchronous handlers. Keep synchronous handler work short so other event-loop work can run between batches.
 */
export interface NativeHost {
  /** Coalesced notice to recheck watched outbound admission tokens. Carries no reservation. A throw fails the host. */
  requestCapacityChanged?(): void;
  /** A throw or an invalid value fails the host and stops payload delivery. */
  capacity(): HostCapacity;
  /**
   * Notify whenever capacity can have increased. Notifications may coalesce and carry no reservation.
   * The binding subscribes before its first capacity read and unsubscribes when delivery stops.
   * Return an idempotent unsubscribe function. A throw or invalid return fails the host.
   */
  subscribeCapacity(wake: () => void): () => void;
  /**
   * One verdict per message, in order. A throw, a rejection or the wrong verdicts ignore
   * every message of the job.
   */
  validate(job: GossipJob): Promise<readonly Verdict[]>;
  /** One classification per check, in order. A throw or the wrong count classifies every check unavailable. */
  checkDependencies(checks: readonly DependencyCheck[]): readonly boolean[];
  /**
   * Ends the stream with finish(), fail() or cancel(), and settles only after the source and its child work retire.
   * A throw or rejection fails the stream.
   */
  serve(request: IncomingRequest): Promise<void>;
  /** Updates replace the previous state of the same peer. A throw fails the network. */
  peers(events: readonly NativePeerObservation[]): void;
  /**
   * A host capacity or peer callback failed with `error`. Payload delivery
   * has stopped and settlement continues: finish bounded cleanup, such as outstanding request handlers, then
   * close the network. A throw closes it at once.
   * An owner failure arrives through `closed` with reason `failed`.
   */
  failed(error: Error): void;
  /**
   * Native log records at or above the configured level, up to 256 every 100 ms and up to 2,048 after close. A throw counts the
   * delivery's records in lodestar_network_log_delivery_errors_total and never fails the network. Failed native drains count
   * separately in lodestar_network_log_drain_errors_total.
   */
  logs(records: readonly NativeLogRecord[]): void;
  /** A failure the binding recovered from: one of the above that threw, rejected or broke its contract. */
  error?(error: unknown): void;
}

/** Promise-returning operations reject both admission errors and admitted operation failures. */
/** Promise-returning commands wait in JavaScript for native admission and reject on close. */
export interface NativeNetwork {
  readonly limits: NativeResolvedLimits;
  /** Native shutdown and its promised completions finished. A failed network cannot restart. */
  readonly closed: Promise<CloseResult>;
  /** Shares reserved admission with updateStatus; one state operation at a time avoids ordinary command pressure. */
  applyIntent(intent: NativeLocalIntent): Promise<void>;
  /** Updates Status for the active fork; preserves clock, subscriptions, Metadata, ENR and demand. */
  updateStatus(status: NetworkStatusUpdate): Promise<void>;
  /** Copies `root` before returning. Throws InvalidNetworkBytes unless it is a 32-byte Uint8Array. */
  blockImported(root: Uint8Array): void;
  /**
   * Supply only the origin captured with the reported work. Omit it when unknown; a current peer snapshot cannot
   * establish where earlier work came from. Identity-only reports never acquire endpoint attribution.
   * Copies context and coalesces reports by identity, origin and reason in native storage. Reports requiring a new
   * row when the table is full count in lodestar_peers_report_peer_dropped_total. Throws, queueing nothing, for a malformed peer id or unknown action.
   */
  reportPeer(peerId: PeerIdStr, action: NativePeerAction, context?: NativePeerReportContext): void;
  dropQueuedGossip(): void;
  /**
   * Stops delivery of peer observations, dependency checks, serving starts and gossip. Irreversible and idempotent.
   * Completions and administrative operations continue; already started host tasks must still retire.
   */
  stopDelivery(): void;
  /**
   * Copies input into a bounded native queue. A full queue rejects with admission_full and a capacityToken,
   * without retaining the input or publishing it. Queued input expires with reason expired before publication
   * after publicationMaxWaitMs or the shorter maxQueueMs supplied by the caller.
   */
  publish(topic: string, data: Uint8Array, options?: NativeGossipPublishOptions): Promise<NativeGossipPublishResult>;
  /**
   * Resolves when the resource that refused publication changes, including before registration.
   * Grants no reservation and retains no payload. The caller chooses timeoutMs within Node's timer range (1..2147483647).
   * Cancellation, timeout and close reject the wait; admitted publications are unaffected.
   */
  waitForPublicationCapacity(token: string, options: {signal: AbortSignal; timeoutMs: number}): Promise<void>;
  /** Throws synchronously for invalid input, admission refusal or a closed network; admitted failures reject next(). */
  request(
    peerId: PeerIdStr,
    protocol: NativeRequestProtocolId,
    data: Uint8Array,
    options?: NativeRequestOptions
  ): AsyncIterableIterator<NativeResponseChunk>;
  /**
   * Resolves when the resource that refused admission changes, including a change before this call.
   * The token belongs to this runtime and grants no reservation. No request is retained or retried.
   * The caller chooses timeoutMs within Node's timer range (1..2147483647); cancellation, expiry and close reject locally.
   */
  waitForRequestCapacity(token: string, options: {signal: AbortSignal; timeoutMs: number}): Promise<void>;
  /** Checks the token and arms requestCapacityChanged atomically when its resource has not changed. */
  watchRequestCapacity(token: string): boolean;
  /** One-shot connection attempt. Its timeout starts at native admission (10 s by default). */
  connect(peerId: PeerIdStr, endpoints: readonly IpEndpoint[], timeoutMs?: bigint): Promise<void>;
  /** Closes the connection and rejects pending connects with NetworkConnectCancelled. Direct membership remains. */
  disconnect(peerId: PeerIdStr): Promise<void>;
  /** Adds persistent direct membership, or with null removes it and reports whether it existed. */
  setDirectPeer(peerId: PeerIdStr, endpoints: readonly IpEndpoint[]): Promise<void>;
  setDirectPeer(peerId: PeerIdStr, endpoints: null): Promise<boolean>;
  reStatus(peerIds: readonly PeerIdStr[]): Promise<void>;
  /** Latest delivered identity, initially populated during initialization. Rejects with NetworkClosed once close() begins. */
  getIdentity(): Promise<NativeIdentity>;
  /** Cached direct-peer membership. Rejects with NetworkClosed once close() begins. */
  getDirectPeers(): Promise<PeerIdStr[]>;
  /** Compact retained scores. Diagnostic commands share one result buffer and wait in the bounded command queue. */
  getPeerScores(): Promise<NativePeerScores>;
  getGossipDiagnostics(cursor?: number): Promise<NativeGossipDiagnosticsPage>;
  /**
   * Prometheus text rendered on demand, including binding counters. Concurrent scrapes share one request;
   * rejects with NetworkClosed once closing begins.
   */
  metrics(): Promise<string>;
  /** Selects the threshold native records are kept at from now on. */
  setLogLevel(level: NativeLogLevel): void;
  /**
   * Stops delivery and completes native shutdown and outstanding operations. The binding finishes shutdown even if
   * only the returned promise remains reachable. Host serving and validation tasks may finish later.
   */
  close(): Promise<CloseResult>;
}

/**
 * Initialize from the owning thread using config.beaconConfig. One native runtime is live per process; a replacement
 * requires the previous runtime to be fully released, including garbage collection after close.
 * Copies configuration and returns a running network drained for `host`. Failure is terminal.
 * The application must call close(); dropping references does not request shutdown. Environment teardown stops
 * native work even when JavaScript cannot run. Invokes no host callback synchronously.
 */
export function createNativeNetwork(config: NativeApplicationConfig, host: NativeHost): NativeNetwork;
