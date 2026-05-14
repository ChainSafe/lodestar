import type {Connection, ConnectionStatus} from "@libp2p/interface";
import {routes} from "@lodestar/api";
import {GoodByeReasonCode} from "../../../constants/network.js";

/**
 * Format a list of connections from libp2p connections manager into the API's format NodePeer
 */
export function formatNodePeer(peerIdStr: string, connections: Connection[]): routes.node.NodePeer {
  const conn = getRelevantConnection(connections);

  return {
    peerId: conn ? conn.remotePeer.toString() : peerIdStr,
    // TODO: figure out how to get enr of peer
    enr: null,
    lastSeenP2pAddress: conn ? conn.remoteAddr.toString() : "",
    direction: conn ? (conn.direction as routes.node.PeerDirection) : null,
    state: conn ? getPeerState(conn.status) : "disconnected",
  };
}

/**
 * Controlled vocabulary for downscore reasons surfaced on the beacon API
 * `/eth/v1/node/peers` extension. Mirrors the proposed `PeerScoreReason` enum
 * so consumers don't have to know lodestar's internal `actionName` strings.
 */
export const PEER_SCORE_REASON = {
  RpcInvalidRequest: "rpc_invalid_request",
  RpcInvalidResponse: "rpc_invalid_response",
  RpcRateLimited: "rpc_rate_limited",
  RpcTimeout: "rpc_timeout",
  RpcIoError: "rpc_io_error",
  RpcBadBlocksByRange: "rpc_bad_blocks_by_range",
  RpcBadBlocksByRoot: "rpc_bad_blocks_by_root",
  GossipInvalidBlock: "gossip_invalid_block",
  GossipInvalidAttestation: "gossip_invalid_attestation",
  GossipInvalidBlobSidecar: "gossip_invalid_blob_sidecar",
  GossipInvalidDataColumnSidecar: "gossip_invalid_data_column_sidecar",
  SyncBadBatch: "sync_bad_batch",
  StatusUnviableFork: "status_unviable_fork",
  BehaviourPenalty: "behaviour_penalty",
  Unknown: "unknown",
} as const;

/**
 * Map lodestar's native `reportPeer` action label to the controlled
 * `PeerScoreReason` vocabulary. Returns "unknown" for actions we don't have
 * an explicit mapping for so the API stays forward-compatible.
 */
export function mapPeerScoreReason(actionName: string | null): string {
  if (actionName === null || actionName === "") return PEER_SCORE_REASON.Unknown;

  switch (actionName) {
    case "REQUEST_ERROR_INVALID_REQUEST":
      return PEER_SCORE_REASON.RpcInvalidRequest;
    case "REQUEST_ERROR_INVALID_RESPONSE_SSZ":
      return PEER_SCORE_REASON.RpcInvalidResponse;
    case "REQUEST_ERROR_SERVER_ERROR":
    case "RESOURCE_UNAVAILABLE_ERROR":
    case "REQUEST_ERROR_UNKNOWN_ERROR_STATUS":
    case "REQUEST_ERROR_EMPTY_RESPONSE":
    case "SSZ_SNAPPY_ERROR_OVER_SSZ_MAX_SIZE":
      return PEER_SCORE_REASON.RpcInvalidResponse;
    case "REQUEST_ERROR_RATE_LIMITED":
    case "REQUEST_ERROR_SELF_RATE_LIMITED":
    case "RESPONSE_ERROR_RATE_LIMITED":
    case "rate_limit_rpc":
      return PEER_SCORE_REASON.RpcRateLimited;
    case "REQUEST_ERROR_REQUEST_TIMEOUT":
    case "REQUEST_ERROR_RESP_TIMEOUT":
    case "REQUEST_ERROR_DIAL_TIMEOUT":
      return PEER_SCORE_REASON.RpcTimeout;
    case "REQUEST_ERROR_DIAL_ERROR":
    case "REQUEST_ERROR_REQUEST_ERROR":
      return PEER_SCORE_REASON.RpcIoError;
    case "BAD_BLOCKS_BY_RANGE":
    case "BadSyncBlocks":
      return PEER_SCORE_REASON.RpcBadBlocksByRange;
    case "BAD_BLOCKS_BY_ROOT":
    case "BadBlockByRoot":
      return PEER_SCORE_REASON.RpcBadBlocksByRoot;
    case "BadGossipBlock":
      return PEER_SCORE_REASON.GossipInvalidBlock;
    case "SyncChainInvalidBatchSelf":
    case "SyncChainInvalidBatchOther":
    case "SyncChainMaxProcessingAttempts":
      return PEER_SCORE_REASON.SyncBadBatch;
    case "GOSSIPSUB_LOW":
      return PEER_SCORE_REASON.BehaviourPenalty;
    default:
      return PEER_SCORE_REASON.Unknown;
  }
}

/**
 * Controlled vocabulary for the most recent peer disconnect reason surfaced
 * on the beacon API `/eth/v1/node/peers` extension. Mirrors the proposed
 * `PeerDisconnectReason` enum.
 */
export const PEER_DISCONNECT_REASON = {
  ClientShutdown: "client_shutdown",
  IrrelevantNetwork: "irrelevant_network",
  IoError: "io_error",
  UnviableFork: "unviable_fork",
  TooManyPeers: "too_many_peers",
  BadScore: "bad_score",
  InboundDisconnect: "inbound_disconnect",
  Unknown: "unknown",
} as const;

/**
 * Map lodestar's `GoodByeReasonCode` to the controlled
 * `PeerDisconnectReason` vocabulary. Returns "unknown" for codes we don't
 * have an explicit mapping for so the API stays forward-compatible.
 */
export function mapDisconnectReason(code: GoodByeReasonCode | number): string {
  switch (code) {
    case GoodByeReasonCode.CLIENT_SHUTDOWN:
      return PEER_DISCONNECT_REASON.ClientShutdown;
    case GoodByeReasonCode.IRRELEVANT_NETWORK:
      return PEER_DISCONNECT_REASON.IrrelevantNetwork;
    case GoodByeReasonCode.ERROR:
      return PEER_DISCONNECT_REASON.IoError;
    case GoodByeReasonCode.TOO_MANY_PEERS:
      return PEER_DISCONNECT_REASON.TooManyPeers;
    case GoodByeReasonCode.SCORE_TOO_LOW:
    case GoodByeReasonCode.BANNED:
      return PEER_DISCONNECT_REASON.BadScore;
    case GoodByeReasonCode.INBOUND_DISCONNECT:
      return PEER_DISCONNECT_REASON.InboundDisconnect;
    default:
      if (code === 128) return PEER_DISCONNECT_REASON.UnviableFork;
      return PEER_DISCONNECT_REASON.Unknown;
  }
}

/**
 * From a list of connections, get the most relevant of a peer
 * - The first open connection if any
 * - Otherwise, the first closing connection
 * - Otherwise, the first closed connection
 */
export function getRelevantConnection(connections: Connection[]): Connection | null {
  const byStatus = new Map<ConnectionStatus, Connection>();
  for (const conn of connections) {
    if (conn.status === "open") return conn;
    if (!byStatus.has(conn.status)) byStatus.set(conn.status, conn);
  }

  return byStatus.get("open") || byStatus.get("closing") || byStatus.get("closed") || null;
}

/**
 * Map libp2p connection status to the API's peer state notation
 * @param status
 */
function getPeerState(status: ConnectionStatus): routes.node.PeerState {
  switch (status) {
    case "open":
      return "connected";
    case "closing":
      return "disconnecting";
    case "closed":
      return "disconnected";
    default:
      return "disconnected";
  }
}
