export enum GoodByeReasonCode {
  INBOUND_DISCONNECT = -1,
  CLIENT_SHUTDOWN = 1,
  IRRELEVANT_NETWORK = 2,
  ERROR = 3,
  TOO_MANY_PEERS = 129,
  SCORE_TOO_LOW = 250,
  BANNED = 251,
}

export const GOODBYE_KNOWN_CODES: Record<string, string> = {
  "-1": "InboundDisconnect",
  0: "Unknown",

  // spec-defined codes
  1: "Client shutdown",
  2: "Irrelevant network",
  3: "Internal fault/error",

  // Teku-defined codes
  128: "Unable to verify network",

  // Lighthouse-defined codes
  129: "Client has too many peers",
  250: "Peer score too low",
  251: "Peer banned this node",
};

/** Until js-libp2p exports an enum for its events */
export enum Libp2pEvent {
  connectionOpen = "connection:open",
  connectionClose = "connection:close",
}

/**
 * Maximum number of payload envelopes that can be requested in a single
 * ExecutionPayloadEnvelopesByRoot request.
 *
 * Mirrors MAX_REQUEST_BLOCKS (128) since payloads correspond 1:1 with blocks.
 */
export const MAX_REQUEST_PAYLOAD_ENVELOPES_BY_ROOT = 128;

/**
 * Maximum number of payload envelopes that can be requested in a single
 * ExecutionPayloadEnvelopesByRange request.
 *
 * TODO: Determine appropriate value based on bandwidth and processing constraints.
 * Suggestion: Match MAX_REQUEST_BLOB_SIDECARS or similar.
 */
export const MAX_REQUEST_PAYLOAD_ENVELOPES_BY_RANGE = 128; // TODO: Adjust as needed
