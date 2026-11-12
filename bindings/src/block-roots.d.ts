/**
 * Roots of a full signed block serialized for fork `forkSeq`, merkleizing the execution payload transactions once.
 * The caller must use the addon's compiled preset without custom SSZ limits.
 *
 * Returns `blockRoot ++ bodyRoot` (64 bytes). Forks whose block body carries an execution payload append the
 * payload's `transactionsRoot` (96 bytes).
 */
export declare function signedBlockRoots(forkSeq: number, signedBlockBytes: Uint8Array): Uint8Array;
