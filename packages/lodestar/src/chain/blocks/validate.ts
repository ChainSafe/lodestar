import {IBlockProcessJob} from "../chain";
import {toHexString} from "@chainsafe/ssz";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
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
        const hexBlockHash = toHexString(blockHash);
        const currentSlot = db.chain.getChainHeadSlot();
        logger.info(
          `Received block with hash ${hexBlockHash}` +
                    `at slot ${job.signedBlock.message.slot}. Current state slot ${currentSlot}`
        );

        if (await db.block.has(blockHash)) {
          logger.warn(`Block ${hexBlockHash} existed already, no need to process it.`);
          continue;
        }

        const finalizedCheckpoint = forkChoice.getFinalized();
        if (job.signedBlock.message.slot <= computeStartSlotAtEpoch(config, finalizedCheckpoint.epoch)) {
          logger.warn(
            `Block ${hexBlockHash} is not after ` +
                        `finalized checkpoint ${toHexString(finalizedCheckpoint.root)}.`
          );
          continue;
        }
        yield job;
      }
    })();
  };
}