/**
 * leanXMSS signatures and their aggregation into leanVM proofs.
 *
 * Source: https://github.com/leanEthereum/leanVM
 */

/**
 * False where the addon was built without the leanVM library, or the CPU lacks an instruction set
 * extension the library was built for. Everything else here then throws or rejects with
 * `LeanvmUnavailable` or `Unavailable`.
 */
export declare const LEANVM_AVAILABLE: boolean;

export declare const XMSS_SEED_SIZE: 32;
export declare const XMSS_MESSAGE_SIZE: 32;
export declare const XMSS_PUBLIC_KEY_SIZE: 32;
export declare const XMSS_SIGNATURE_SIZE: 2404;
/** A packed claim: the public key, then the message it signed. */
export declare const XMSS_CLAIM_SIZE: 64;
/** A packed signed claim: the public key, the message, then the signature. */
export declare const XMSS_SIGNED_SIZE: 2468;
/** The most children one `aggregateXmssSignatures` call takes. */
export declare const XMSS_AGGREGATE_MAX_CHILDREN: 16;
/** Exclusive cap on an aggregate's claims. */
export declare const XMSS_AGGREGATE_MAX_CLAIMS: 65536;
export declare const XMSS_AGGREGATE_MIN_LOG_INV_RATE: 1;
export declare const XMSS_AGGREGATE_MAX_LOG_INV_RATE: 4;

/**
 * A leanXMSS secret key. Obtain one from `generate` or `fromSeed`: an instance made with `new`
 * holds no key, and its methods throw `KeyNotLoaded`.
 *
 * Generating a key and signing run off the JS thread, on leanVM's own thread pool.
 */
export declare class XmssSecretKey {
  /** A fresh key, its seed from the operating system's randomness. */
  static generate(): Promise<XmssSecretKey>;
  /** The key of a `XMSS_SEED_SIZE`-byte seed, which is all of its secret material. */
  static fromSeed(seed: Uint8Array): Promise<XmssSecretKey>;
  /** SECRET KEY MATERIAL. */
  toSeed(): Uint8Array;
  toPublicKey(): Uint8Array;
  /**
   * Builds the bottom tree `leafIndex` is in: the 2^16 leaf indices that share its top 16 bits.
   * The first `sign` in a bottom tree otherwise pays for it.
   */
  prepare(leafIndex: number): Promise<void>;
  /**
   * Signs a `XMSS_MESSAGE_SIZE`-byte message at `leafIndex`, a uint32. Deterministic.
   *
   * NEVER sign two different messages with the same key and leaf index: nothing here records the
   * indices a key has used.
   */
  sign(message: Uint8Array, leafIndex: number): Promise<Uint8Array>;
}

/** Whether `signature` is `publicKey`'s on `message`. Throws when an argument has the wrong length. */
export declare function verifyXmssSignature(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;

/**
 * A proof that each of its claims is backed by a valid leanXMSS signature, at a leaf index it does
 * not reveal. `proof` is what goes on the wire, which carries no claims: the receiver supplies the
 * claims it expects.
 */
export interface XmssAggregate {
  proof: Uint8Array;
  /** Packed claims, strictly sorted as bytes, so they hold no duplicate. */
  claims: Uint8Array;
}

/**
 * Compiles the aggregation program ahead of the first `aggregateXmssSignatures` or
 * `verifyXmssAggregate`, which otherwise pays for it.
 */
export declare function setupXmssAggregation(): Promise<void>;

/**
 * Proves that every claim of the result is backed by a valid leanXMSS signature.
 *
 * - `children`: at most `XMSS_AGGREGATE_MAX_CHILDREN` earlier aggregates.
 * - `signed`: packed signed claims, in any order.
 * - `logInvRate`: in `XMSS_AGGREGATE_MIN_LOG_INV_RATE..=XMSS_AGGREGATE_MAX_LOG_INV_RATE`. Higher
 *   is a smaller proof and a slower prover.
 * - `declare`: when omitted, the result claims everything the children and `signed` do. Otherwise
 *   it claims exactly these packed, strictly sorted claims, each covered by a child or by `signed`.
 *
 * Neither the children nor the signatures are verified first. An invalid one rejects, usually with
 * `Prove`, and never yields a proof of a false claim: verify inputs first to learn which is invalid.
 *
 * Takes seconds and gigabytes, off the JS thread. Aggregations run one at a time.
 *
 * Rejects with `InvalidChild`, `Empty`, `NotCovered`, `MalformedRawSignature`, `TooLarge`,
 * `InvalidRate`, `ChildOutOfRange` or `Prove`.
 */
export declare function aggregateXmssSignatures(
  children: XmssAggregate[],
  signed: Uint8Array,
  logInvRate: number,
  declare?: Uint8Array
): Promise<XmssAggregate>;

/**
 * Resolves with whether `proof` proves exactly `claims`, off the JS thread.
 *
 * Rejects with `MalformedSignerSet` when the claims are not strictly sorted or number
 * `XMSS_AGGREGATE_MAX_CLAIMS` or more.
 */
export declare function verifyXmssAggregate(proof: Uint8Array, claims: Uint8Array): Promise<boolean>;
