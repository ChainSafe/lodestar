import {computeTimeAtSlot, DataAvailableStatus} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {deneb, UintNum64} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {validateBlobSidecars} from "../validation/blobSidecar.js";
import {Metrics} from "../../metrics/metrics.js";
import {BlockInput, BlockInputType, ImportBlockOpts, BlobSidecarValidation} from "./types.js";

// we can now wait for full 12 seconds because unavailable block sync will try pulling
// the blobs from the network anyway after 500ms of seeing the block
const BLOB_AVAILABILITY_TIMEOUT = 12_000;

/**
 * Verifies some early cheap sanity checks on the block before running the full state transition.
 *
 * - Parent is known to the fork-choice
 * - Check skipped slots limit
 * - check_block_relevancy()
 *   - Block not in the future
 *   - Not genesis block
 *   - Block's slot is < Infinity
 *   - Not finalized slot
 *   - Not already known
 */
export async function verifyBlocksDataAvailability(
  chain: {config: ChainForkConfig; genesisTime: UintNum64; logger: Logger; metrics: Metrics | null},
  blocks: BlockInput[],
  opts: ImportBlockOpts
): Promise<{dataAvailabilityStatuses: DataAvailableStatus[]; availableTime: number}> {
  if (blocks.length === 0) {
    throw Error("Empty partiallyVerifiedBlocks");
  }

  const dataAvailabilityStatuses: DataAvailableStatus[] = [];
  const seenTime = opts.seenTimestampSec !== undefined ? opts.seenTimestampSec * 1000 : Date.now();

  for (const blockInput of blocks) {
    // Validate status of only not yet finalized blocks, we don't need yet to propogate the status
    // as it is not used upstream anywhere
    const dataAvailabilityStatus = await maybeValidateBlobs(chain, blockInput, opts);
    dataAvailabilityStatuses.push(dataAvailabilityStatus);
  }

  const availableTime = blocks[blocks.length - 1].type === BlockInputType.blobsPromise ? Date.now() : seenTime;
  if (blocks.length === 1 && opts.seenTimestampSec !== undefined && blocks[0].type !== BlockInputType.preDeneb) {
    const recvToAvailableTime = availableTime / 1000 - opts.seenTimestampSec;
    const numBlobs = (blocks[0].block as deneb.SignedBeaconBlock).message.body.blobKzgCommitments.length;

    chain.metrics?.gossipBlock.receivedToBlobsAvailabilityTime.observe({numBlobs}, recvToAvailableTime);
    chain.logger.verbose("Verified blobs availability", {
      slot: blocks[0].block.message.slot,
      recvToAvailableTime,
      type: blocks[0].type,
    });
  }

  return {dataAvailabilityStatuses, availableTime};
}

async function maybeValidateBlobs(
  chain: {config: ChainForkConfig; genesisTime: UintNum64; logger: Logger},
  blockInput: BlockInput,
  opts: ImportBlockOpts
): Promise<DataAvailableStatus> {
  switch (blockInput.type) {
    case BlockInputType.preDeneb:
      return DataAvailableStatus.preDeneb;

    case BlockInputType.postDeneb:
      if (opts.validBlobSidecars === BlobSidecarValidation.Full) {
        return DataAvailableStatus.available;
      }

    // eslint-disable-next-line no-fallthrough
    case BlockInputType.blobsPromise: {
      // run full validation
      const {block} = blockInput;
      const blockSlot = block.message.slot;

      const blobsData =
        blockInput.type === BlockInputType.postDeneb
          ? blockInput
          : await raceWithCutoff(chain, blockInput, blockInput.availabilityPromise);
      const {blobs} = blobsData;

      const {blobKzgCommitments} = (block as deneb.SignedBeaconBlock).message.body;
      const beaconBlockRoot = chain.config.getForkTypes(blockSlot).BeaconBlock.hashTreeRoot(block.message);

      // if the blob siddecars have been individually verified then we can skip kzg proof check
      // but other checks to match blobs with block data still need to be performed
      const skipProofsCheck = opts.validBlobSidecars === BlobSidecarValidation.Individual;
      validateBlobSidecars(blockSlot, beaconBlockRoot, blobKzgCommitments, blobs, {skipProofsCheck});

      return DataAvailableStatus.available;
    }
  }
}

/**
 * Wait for blobs to become available with a cutoff time. If fails then throw DATA_UNAVAILABLE error
 * which may try unknownblock/blobs fill (by root).
 */
async function raceWithCutoff<T>(
  chain: {config: ChainForkConfig; genesisTime: UintNum64; logger: Logger},
  blockInput: BlockInput,
  availabilityPromise: Promise<T>
): Promise<T> {
  const {block} = blockInput;
  const blockSlot = block.message.slot;

  const cutoffTime = Math.max(
    computeTimeAtSlot(chain.config, blockSlot, chain.genesisTime) * 1000 + BLOB_AVAILABILITY_TIMEOUT - Date.now(),
    0
  );
  const cutoffTimeout = new Promise((_resolve, reject) => setTimeout(reject, cutoffTime));
  chain.logger.debug("Racing for blob availabilityPromise", {blockSlot, cutoffTime});

  try {
    await Promise.race([availabilityPromise, cutoffTimeout]);
  } catch (e) {
    // throw unavailable so that the unknownblock/blobs can be triggered to pull the block
    throw new BlockError(block, {code: BlockErrorCode.DATA_UNAVAILABLE});
  }
  // we can only be here if availabilityPromise has resolved else an error will be thrown
  return availabilityPromise;
}
