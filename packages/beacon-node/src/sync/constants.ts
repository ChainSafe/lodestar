/** The number of head syncing chains to sync at a time. */
export const PARALLEL_HEAD_CHAINS = 2;

/** Minimum work we require a finalized chain to do before picking a chain with more peers. */
export const MIN_FINALIZED_CHAIN_VALIDATED_EPOCHS = 10;

/** The number of times to retry a batch before it is considered failed. */
// export const MAX_BATCH_DOWNLOAD_ATTEMPTS = 5;
// this constant is increased a lot for peerDAS because we may have many failed download due to rate limit not implemented yet
// TODO: change it back to 5 when this issue is implemented https://github.com/ChainSafe/lodestar/issues/8033
export const MAX_BATCH_DOWNLOAD_ATTEMPTS = 20;

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
 * This is according to the spec https://github.com/ethereum/consensus-specs/blob/dev/specs/phase0/p2p-interface.md
 */
export const MAX_CONCURRENT_REQUESTS = 2;

/**
 * Maximum number of epochs to download ahead when syncing.
 * In fulu, to fully process a batch we may need to download columns from multiple peers
 * so having this constant too big is a waste of resources and peers may rate limit us.
 */
export const MAX_LOOK_AHEAD_EPOCHS = 2;
