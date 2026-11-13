/**
 * Execution block hash of an SSZ-serialized `ExecutionPayload` of the fork with sequence number `forkSeq`,
 * bellatrix through heze: keccak256 of the RLP-encoded execution block header.
 *
 * `parentBeaconBlockRoot` is required from deneb. `executionRequests`, the SSZ-serialized `ExecutionRequests`
 * of the same fork, is required from electra.
 *
 * Throws on a malformed serialization and on an empty transaction, which no valid payload has.
 */
export declare function computeExecutionBlockHash(
  forkSeq: number,
  payload: Uint8Array,
  parentBeaconBlockRoot?: Uint8Array,
  executionRequests?: Uint8Array
): Uint8Array;

/** Root of the transactions trie of an SSZ-serialized transactions list. Throws on an empty transaction. */
export declare function computeTransactionsRoot(transactions: Uint8Array): Uint8Array;
