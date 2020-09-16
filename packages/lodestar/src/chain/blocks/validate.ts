import {toHexString} from "@chainsafe/ssz";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {IBlockProcessJob} from "../interface";
import {ChainEventEmitter} from "../emitter";

export function validateBlock(
  config: IBeaconConfig,
  logger: ILogger,
  forkChoice: IForkChoice,
  eventBus: ChainEventEmitter
): (source: AsyncIterable<IBlockProcessJob>) => AsyncGenerator<IBlockProcessJob> {
  return (source) => {
    return (async function* () {
      for await (const job of source) {
        const blockHash = config.types.BeaconBlock.hashTreeRoot(job.signedBlock.message);
        if (!job.reprocess && forkChoice.hasBlock(blockHash)) {
          logger.debug(`Block ${toHexString(blockHash)} was already processed, skipping...`);
          eventBus.emit("block", job.signedBlock);
          continue;
        }
        const finalizedCheckpoint = forkChoice.getFinalizedCheckpoint();
        if (
          finalizedCheckpoint &&
          finalizedCheckpoint.epoch > 0 &&
          computeEpochAtSlot(config, job.signedBlock.message.slot) < finalizedCheckpoint.epoch
        ) {
          logger.debug(
            `Block ${toHexString(blockHash)} with slot ${job.signedBlock.message.slot} is not after ` +
              `finalized epoch (${finalizedCheckpoint.epoch}).`
          );
          continue;
        }
        const currentSlot = forkChoice.getHead().slot;
        logger.debug(
          `Received block with hash ${toHexString(blockHash)}` +
            `at slot ${job.signedBlock.message.slot}. Current state slot ${currentSlot}`
        );
        yield job;
      }
    })();
  };
}
