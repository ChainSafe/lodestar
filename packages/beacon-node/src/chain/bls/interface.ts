import {ISignatureSet} from "@lodestar/state-transition";

export type SameMessageSignatureSet = {
  index: number;
  signature: Uint8Array;
};

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
   * Use main thread to verify signatures, use this with care.
   * Ignore the batchable option if this is true.
   */
  verifyOnMainThread?: boolean;
  /**
   * Some signature sets are more important than others, and should be verified first.
   */
  priority?: boolean;
};

/**
 * Stage times of one traced verification in `performance.now()` ms, NaN until reached. The submitter stamps `built`;
 * the worker pool stamps the rest, keeping each stage's latest time when it splits the sets into several jobs. A
 * verification on the main thread records none of the pool's stages.
 */
export class BlsJobTimes {
  /** The signature sets were built, just before submission */
  built = NaN;
  /** The pool picked the job for a worker dispatch */
  selected = NaN;
  /** The dispatch's work requests were prepared, before posting them to the worker */
  prepared = NaN;
  /** The worker started the dispatch, as the worker stamped it */
  workerStart = NaN;
  /** The worker finished the dispatch, as the worker stamped it; the dispatch's results return together */
  workerEnd = NaN;
  /** The dispatch's result reached JS */
  received = NaN;
  /** Signature sets in the dispatch, the job's own included; 0 before */
  dispatchSets = 0;
}

export interface IBlsVerifier {
  /**
   * Verify 1 or more signature sets. Sets may be verified on batch or not depending on their count
   *
   * Signatures all come from the wire (untrusted) are all bytes compressed, must be:
   * - Parsed from bytes
   * - Uncompressed
   * - subgroup_check
   * - consume in Pairing.aggregate as affine, or mul_n_aggregate as affine
   * Just send the raw signture recevied as bytes to the thread and verify there
   *
   * Pubkeys all come from cache (trusted) have already been checked for subgroup and infinity
   * - Some pubkeys will have to be aggregated, some don't
   * - Pubkeys must be available in jacobian coordinates to make aggregation x3 faster
   * - Then, consume in Pairing.aggregate as affine, or mul_n_aggregate as affine
   *
   * All signatures are not trusted and must be group checked (p2.subgroup_check)
   *
   * Public keys have already been checked for subgroup and infinity
   * Signatures have already been checked for subgroup
   * Signature checks above could be done here for convienence as well
   *
   * `times`, when given, receives the verification's stage times.
   */
  verifySignatureSets(sets: ISignatureSet[], opts?: VerifySignatureOpts, times?: BlsJobTimes): Promise<boolean>;

  /**
   * Similar to verifySignatureSets but:
   *   - all signatures have the same message
   *   - return an array of boolean, each element indicates whether the corresponding signature set is valid
   *   - only support `batchable` option
   */
  verifySignatureSetsSameMessage(
    sets: SameMessageSignatureSet[],
    message: Uint8Array,
    opts?: Omit<VerifySignatureOpts, "verifyOnMainThread">
  ): Promise<boolean[]>;

  /** `performance.now()` time the latest verification result from a worker reached JS, when there is one */
  readonly resultAt?: number;

  /** For multithread pool awaits terminating all workers */
  close(): Promise<void>;

  /**
   * Returns true if BLS worker pool is ready to accept more work jobs.
   */
  canAcceptWork(): boolean;
}
