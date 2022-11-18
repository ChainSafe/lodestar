/** The number of head syncing chains to sync at a time. */
export const PARALLEL_HEAD_CHAINS = 2;

/** Minimum work we require a finalized chain to do before picking a chain with more peers. */
export const MIN_FINALIZED_CHAIN_VALIDATED_EPOCHS = 10;

/** The number of times to retry a batch before it is considered failed. */
export const MAX_BATCH_DOWNLOAD_ATTEMPTS = 5;

/** Consider batch faulty after downloading and processing this number of times */
export const MAX_BATCH_PROCESSING_ATTEMPTS = 3;

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
