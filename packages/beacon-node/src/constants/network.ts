/**
 * For more info on some of these constants:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#configuration
 */

// Gossip constants

/**
 * The maximum number of slots during which an attestation can be propagated.
 */
export const ATTESTATION_PROPAGATION_SLOT_RANGE = 32;

/** The maximum allowed size of uncompressed gossip messages. */
export const GOSSIP_MAX_SIZE = 2 ** 20;
export const GOSSIP_MAX_SIZE_BELLATRIX = 10 * GOSSIP_MAX_SIZE;
/** The maximum allowed size of uncompressed req/resp chunked responses. */
export const MAX_CHUNK_SIZE = 2 ** 20;
export const MAX_CHUNK_SIZE_BELLATRIX = 10 * MAX_CHUNK_SIZE;

export enum GoodByeReasonCode {
  CLIENT_SHUTDOWN = 1,
  IRRELEVANT_NETWORK = 2,
  ERROR = 3,
  TOO_MANY_PEERS = 129,
  SCORE_TOO_LOW = 250,
  BANNED = 251,
}

export const GOODBYE_KNOWN_CODES: Record<string, string> = {
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

/** Until js-libp2p types its events */
export enum Libp2pEvent {
  peerConnect = "peer:connect",
  peerDisconnect = "peer:disconnect",
}
