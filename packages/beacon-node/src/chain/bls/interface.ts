import {ISignatureSet} from "@lodestar/state-transition";

export type VerifySignatureOpts = {
  /**
   * A batchable set MAY be verified with more sets to reduce the verification costs.
   * Multiple sets may be merged and verified as one set. If the result is correct, success is returned
   * for all them. If at least one set is invalid, all sets are reverified individually. For normal network
   * conditions this strategy can yield 50% improvement in CPU time spent verifying gossip objects.
   * Only non-time critical objects should be marked as batchable, since the pool may hold them for 100ms.
   */
  batchable?: boolean;

  /**
   * Use main thread (synchronous) to verify signatures. Use this for time-critical
   * verification where the latency of async dispatch is unacceptable (e.g. gossip blocks).
   * Ignores the batchable option if true.
   */
  verifyOnMainThread?: boolean;

  /**
   * Some signature sets are more important than others, and should be verified first.
   */
  priority?: boolean;
};

export interface IBlsVerifier {
  /**
   * Verify 1 or more signature sets. Sets may be verified in batch or individually depending on opts.
   *
   * Signatures come from the wire (untrusted), compressed bytes.
   * Public keys come from the global pubkey cache (trusted) or are provided directly.
   */
  verifySignatureSets(sets: ISignatureSet[], opts?: VerifySignatureOpts): Promise<boolean>;

  /**
   * Verify multiple signatures over the same message, returning per-set validity.
   * All sets are identified by validator index — pubkey resolution happens natively.
   *
   * On aggregate failure, retries each set individually to identify the invalid one(s).
   */
  verifySignatureSetsSameMessage(
    sets: {index: number; signature: Uint8Array}[],
    message: Uint8Array,
    opts?: Omit<VerifySignatureOpts, "verifyOnMainThread">
  ): Promise<boolean[]>;

  /** Cleanup resources */
  close(): Promise<void>;

  /** Returns true if the verifier can accept more work */
  canAcceptWork(): boolean;
}
