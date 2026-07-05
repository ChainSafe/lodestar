/** The number of head syncing chains to sync at a time. */
export const PARALLEL_HEAD_CHAINS = 2;

/** Minimum work we require a finalized chain to do before picking a chain with more peers. */
export const MIN_FINALIZED_CHAIN_VALIDATED_EPOCHS = 10;

/** The number of times to retry a batch before it is considered failed. */
export const MAX_BATCH_DOWNLOAD_ATTEMPTS = 5;

/**
 * Backoff before assigning more range-sync batches to a peer that rate-limited us.
 *
 * Note: this is used when rate limited due to MAX_CONCURRENT_REQUESTS
 */
export const RATE_LIMITED_PEER_BACKOFF_MS = 5_000;

/**
 * Consider batch faulty after downloading and processing this number of times
 * as in https://github.com/ChainSafe/lodestar/issues/8147 we cannot proceed the sync chain if there is unknown parent
 * from prior batch. For example a peer may send us a non-canonical chain segment or not returning all blocks
 * in that case we should throw error and `RangeSync` should remove that error chain and add a new one.
 **/
export const MAX_BATCH_PROCESSING_ATTEMPTS = 0;

/**
 * Number of slots to offset batches.
 *
 * Before Jul2022 an offset of 1 was required to download the checkpoint block during finalized sync. Otherwise
 * the block necessary so switch from Finalized sync to Head sync won't be in the fork-choice and range sync would
 * be stuck in a loop downloading the previous epoch to finalized epoch, until we get rate-limited.
 *
 * After Jul2022 during finalized sync the entire epoch of finalized epoch will be downloaded fulfilling the goal
 * to switch to Head sync latter. This does not affect performance nor sync speed and just downloads a few extra
 * blocks that would be required by Head sync anyway. However, having an offset of 0 allows to send to the processor
 * blocks that belong to the same epoch, which enables batch verification optimizations.
 */
export const BATCH_SLOT_OFFSET = 0;

/** First epoch to allow to start gossip  */
export const MIN_EPOCH_TO_START_GOSSIP = -1;

/**
 * Blocks are downloaded in batches from peers. This constant specifies how many epochs worth of
 * blocks per batch are requested _at most_. A batch may request less blocks to account for
 * already requested slots. There is a timeout for each batch request. If this value is too high,
 * we will negatively report peers with poor bandwidth. This can be set arbitrarily high, in which
 * case the responder will fill the response up to the max request size, assuming they have the
 * bandwidth to do so.
 *
 * Jul2022: Current batch block processor wants only blocks in the same epoch. So we'll process only
 * one batch at a time. Metrics can confirm preliminary tests that speed is as good.
 */
export const EPOCHS_PER_BATCH = 1;

/**
 * The maximum number of batches to queue before requesting more.
 * In good network conditions downloading batches is much faster than processing them
 * A number > 10 epochs worth results in wasted progress when the chain completes syncing
 *
 * TODO: When switching branches usually all batches in AwaitingProcessing are dropped, could it be optimized?
 */
export const BATCH_BUFFER_SIZE = Math.ceil(10 / EPOCHS_PER_BATCH);

/**
 * Maximum number of concurrent requests to perform with a SyncChain.
 * This is according to the spec https://github.com/ethereum/consensus-specs/blob/v1.6.1/specs/phase0/p2p-interface.md
 */
export const MAX_CONCURRENT_REQUESTS = 2;

/**
 * Maximum number of epochs to download ahead when syncing.
 * In fulu, to fully process a batch we may need to download columns from multiple peers
 * so having this constant too big is a waste of resources and peers may rate limit us.
 */
export const MAX_LOOK_AHEAD_EPOCHS = 2;

/**
 * Ceiling, in epochs of non-finality, on how far a TargetSync backward `by_head` walk will descend
 * before giving up.
 *
 * The walk's PRIMARY depth bound is our finalized checkpoint: it descends in slot order and stops as
 * soon as it reaches a slot at or below our finalized slot (`FAILURE_BEFORE_FINALIZED`), since a
 * target that only links to us below finality is on a fork we would never adopt. So the natural depth
 * is `target_slot − finalized_slot` — the non-finality window — and under healthy finality that is a
 * couple of epochs and this ceiling never binds.
 *
 * This constant is the SECONDARY backstop: a sustained inactivity leak can push the finalized
 * checkpoint arbitrarily far below the head, and a node that far behind should restart from a recent
 * checkpoint (checkpoint sync) rather than backward-walk an unbounded header chain. It is set
 * generously (far above any healthy non-finality) so it never bounds a legitimate near-head walk —
 * exceeding it means the gap is too large for backward sync, not that a normal walk was truncated.
 *
 * Converted to slots (× SLOTS_PER_EPOCH) at the walk. INTENTIONALLY decoupled from
 * STORE_MEMORY_THRESHOLD: the per-target store spills older blocks to disk as the walk grows, so the
 * walk budget need not fit in memory.
 */
export const MAX_TARGET_SYNC_NON_FINALITY_EPOCHS = 256;
