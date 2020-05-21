import {IBlockProcessJob} from "../chain";
import {toHexString} from "@chainsafe/ssz";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {ILMDGHOST} from "../forkChoice";

export function validateBlock(
  config: IBeaconConfig, logger: ILogger, forkChoice: ILMDGHOST
): (source: AsyncIterable<IBlockProcessJob>) => AsyncGenerator<IBlockProcessJob> {
  return (source) => {
    return (async function*() {
      for await(const job of source) {
        const blockHash = config.types.BeaconBlock.hashTreeRoot(job.signedBlock.message);
        if (forkChoice.hasBlock(blockHash)) {
          logger.debug(`Block ${toHexString(blockHash)} was already processed, skipping...`);
          continue;
        }
        const finalizedCheckpoint = forkChoice.getFinalized();
        if (finalizedCheckpoint && finalizedCheckpoint.epoch > 0
            && computeEpochAtSlot(config, job.signedBlock.message.slot) <= finalizedCheckpoint.epoch) {
          logger.debug(
            `Block ${toHexString(blockHash)} with slot ${job.signedBlock.message.slot} is not after ` +
                        `finalized epoch (${finalizedCheckpoint.epoch}).`
          );
          continue;
        }
        const currentSlot = forkChoice.headBlockSlot();
        logger.debug(
          `Received block with hash ${toHexString(blockHash)}` +
            `at slot ${job.signedBlock.message.slot}. Current state slot ${currentSlot}`
        );
        yield job;
      }
    })();
  };
}
