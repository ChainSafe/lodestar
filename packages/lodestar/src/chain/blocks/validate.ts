import {IBlockProcessJob} from "../chain";
import {toHexString} from "@chainsafe/ssz";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconDb} from "../../db/api";
import {ILMDGHOST} from "../forkChoice";

export function validateBlock(
  config: IBeaconConfig, logger: ILogger, db: IBeaconDb, forkChoice: ILMDGHOST
): (source: AsyncIterable<IBlockProcessJob>) => AsyncGenerator<IBlockProcessJob> {
  return (source) => {
    return (async function*() {
      for await(const job of source) {
        const blockHash = config.types.BeaconBlock.hashTreeRoot(job.signedBlock.message);
        if (await db.block.has(blockHash)) {
          logger.warn(`Block ${toHexString(blockHash)} was already processed, skipping...`);
          continue;
        }
        const finalizedCheckpoint = forkChoice.getFinalized();
        if (finalizedCheckpoint.epoch > 0 && computeEpochAtSlot(config, job.signedBlock.message.slot) <= finalizedCheckpoint.epoch) {
          logger.warn(
            `Block ${toHexString(blockHash)} with slot ${job.signedBlock.message.slot} is not after ` +
                        `finalized epoch (${finalizedCheckpoint.epoch}).`
          );
          continue;
        }
        const currentSlot = (await db.block.get(forkChoice.head())).message.slot;
        logger.info(
          `Received block with hash ${toHexString(blockHash)}` +
            `at slot ${job.signedBlock.message.slot}. Current state slot ${currentSlot}`
        );
        yield job;
      }
    })();
  };
}