import {ChainForkConfig} from "@lodestar/config";
import {DataAvailabilityStatus} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {UintNum64, deneb} from "@lodestar/types";
import {ErrorAborted, Logger} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {validateBlobsAndProofs, validateBlobSidecars} from "../validation/blobSidecar.js";
import {validateDataColumnsSidecars} from "../validation/dataColumnSidecar.js";
import {BlockInput, isBlockInputBlobs, isBlockInputColumns, isBlockInputPreDeneb} from "./utils/blockInput.js";
import {
  BlobSidecarValidation,
  // BlockInput,
  BlockInputAvailableData,
  BlockInputDataColumns,
  BlockInputType,
  ImportBlockOpts,
  getBlockInput,
} from "./types.js";

// we can now wait for full 12 seconds because unavailable block sync will try pulling
// the blobs from the network anyway after 500ms of seeing the block
const BLOB_AVAILABILITY_TIMEOUT = 12_000;

/**
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/deneb/fork-choice.md#is_data_available
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/fulu/fork-choice.md#modified-is_data_available
 *
 * Most checks are handled when data and blocks are checked against each other in the BlockInput class. All
 * blobs and columns have their commitments matched with the commitments in the block to ensure that they
 * are identical.  Proofs are checked via gossip and reqresp validation to meet the verification portion
 * of this spec function.  All that is necessary is to wait for all data to be available for the block to
 * meet the spec requirements of `retrieve_blobs_and_proofs` and `retrieve_column_sidecars`
 */
export async function isDataAvailable(
  chain: {config: ChainForkConfig; genesisTime: UintNum64; logger: Logger; metrics: Metrics | null},
  blocks: BlockInput[],
  signal: AbortSignal
): Promise<{
  availableTime: number;
  availableBlockInputs: BlockInput[];
}> {
  if (blocks.length === 0) {
    throw Error("Empty partiallyVerifiedBlocks");
  }

  const availableBlockInputs: BlockInput[] = [];

  for (const blockInput of blocks) {
    const slot = blockInput.getSlot();
    if (signal.aborted) {
      throw new ErrorAborted("verifyBlocksDataAvailability");
    }

    switch (blockInput.dataAvailability) {
      case DataAvailabilityStatus.PreData:
      case DataAvailabilityStatus.OutOfRange:
        break;
      // Data is not necessary for out of range blocks or for pre-deneb before the data layer
      case DataAvailabilityStatus.Available: {
        // wait until the end of the slot to timeout
        await blockInput
          .waitForData(
            computeTimeAtSlot(chain.config, slot, chain.genesisTime) * 1000 + BLOB_AVAILABILITY_TIMEOUT - Date.now()
          )
          .catch(() => {
            throw new BlockError(blockInput.getBlock().block, {code: BlockErrorCode.DATA_UNAVAILABLE});
          });
        // As long as all blobs are available at this time is_data_available will be true. All other conditions are
        // checked when the data and the block are added to the BlockInput to ensure that it all goes together and
        // is correct from a protocol perspective
      }
    }

    // const numBlobs = blockInput.numberOfBlobs();
    // const recvToAvailableTime = blockInput.getTimeComplete() - blockInput.timeFirstSeenSec;
    // chain.metrics?.gossipBlock.receivedToBlobsAvailabilityTime.observe({numBlobs}, recvToAvailableTime);
    // chain.logger.verbose("Verified data availability", {
    //   recvToAvailableTime,
    //   ...blockInput.getLogMeta(),
    // });
    availableBlockInputs.push(blockInput);
  }

  return {availableBlockInputs};
}
