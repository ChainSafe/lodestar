export declare const BLS_VERIFIER_SET_TYPE: {
  readonly indexed: 0;
  readonly aggregate: 1;
  readonly single: 2;
};

export declare const BLS_VERIFIER_MAX_BATCH_SIZE: 256;
export declare const BLS_VERIFIER_MAX_SAME_MESSAGE_BATCH_SIZE: 128;

export type BlsVerifierSetTypeValue = (typeof BLS_VERIFIER_SET_TYPE)[keyof typeof BLS_VERIFIER_SET_TYPE];

export type IndexedSignatureSet = {
  type: typeof BLS_VERIFIER_SET_TYPE.indexed;
  index: number;
  message: Uint8Array;
  signature: Uint8Array;
};

export type AggregateSignatureSet = {
  type: typeof BLS_VERIFIER_SET_TYPE.aggregate;
  indices: Uint32Array;
  message: Uint8Array;
  signature: Uint8Array;
};

export type SingleSignatureSet = {
  type: typeof BLS_VERIFIER_SET_TYPE.single;
  pubkey: Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
};

export type BlsSignatureSet = IndexedSignatureSet | AggregateSignatureSet | SingleSignatureSet;

export type SameMessageSignatureSet = {
  index: number;
  signature: Uint8Array;
};

/**
 * Verify signature sets using cached pubkeys for indexed and aggregate sets.
 * The verifier validates every signature before pairing.
 *
 * Returns false as soon as one of these conditions are encountered:
 *
 * - A signature is malformed or cryptographically invalid.
 * - A single set public key is malformed or cryptographically invalid.
 *
 * Throws cache and interface errors when encountered before the result is
 * known.
 */
export declare function verifySignatureSets(sets: BlsSignatureSet[]): boolean;

/**
 * Randomly aggregate and verify cached pubkeys and signatures over one message.
 * The verifier validates every signature.
 *
 * Returns false for an input set when its signature is malformed or cryptographically invalid.
 *
 * Returns one result per input. Invalid interface state throws.
 */
export declare function verifySignatureSetsSameMessage(sets: SameMessageSignatureSet[], message: Uint8Array): boolean[];
