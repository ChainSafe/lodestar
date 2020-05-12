import {IBlockProcessJob} from "../chain";
import {BeaconState, Root, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {stateTransition, computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../db/api";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {ILMDGHOST} from "../forkChoice";
import {BlockPool} from "./pool";
import {ChainEventEmitter} from "..";

export function processBlock(
  config: IBeaconConfig,
  db: IBeaconDb,
  logger: ILogger,
  forkChoice: ILMDGHOST,
  pool: BlockPool,
  eventBus: ChainEventEmitter,
): (source: AsyncIterable<IBlockProcessJob>) => AsyncGenerator<{block: SignedBeaconBlock; postState: BeaconState}> {
  return (source) => {
    return (async function*() {
      for await(const job of source) {
        const blockRoot = config.types.BeaconBlock.hashTreeRoot(job.signedBlock.message);
        const preState = await getPreState(config, db, pool, logger, job);
        if(!preState) {
          continue;
        }
        // Run the state transition
        const newState = await runStateTransition(config, db, logger, preState, job);
        if(!newState) {
          continue;
        }
        // On successful transition, update system state
        await Promise.all([
          db.state.put(job.signedBlock.message.stateRoot.valueOf() as Uint8Array, newState),
          db.block.put(blockRoot, job.signedBlock),
        ]);
        const newChainHeadRoot = await updateForkChoice(config, db, forkChoice, job.signedBlock, newState);
        if(newChainHeadRoot) {
          logger.info(`Processed new chain head 0x${toHexString(newChainHeadRoot)} as slot ${newState.slot}`);
          if(!config.types.Fork.equals(preState.fork, newState.fork)) {
            const epoch = computeEpochAtSlot(config, newState.slot);
            const currentVersion = newState.fork.currentVersion;
            logger.important(`Fork version changed to ${currentVersion} at slot ${newState.slot} and epoch ${epoch}`);
            eventBus.emit("forkDigestChanged");
          }
        }
        pool.onProcessedBlock(job.signedBlock);
        yield {preState, postState: newState, block: job.signedBlock};
      }
    })();
  };

}

export async function getPreState(
  config: IBeaconConfig, db: IBeaconDb, pool: BlockPool, logger: ILogger, job: IBlockProcessJob
): Promise<BeaconState|null> {
  const parentBlock = await db.block.get(job.signedBlock.message.parentRoot.valueOf() as Uint8Array);
  if (!parentBlock) {
    const blockRoot = config.types.BeaconBlock.hashTreeRoot(job.signedBlock.message);
    logger.debug(`Block(${toHexString(blockRoot)}) at slot ${job.signedBlock.message.slot}`
            + ` is missing parent block (${toHexString(job.signedBlock.message.parentRoot)}).`
    );
    pool.addPendingBlock(job);
    return null;
  }
  return await db.state.get(parentBlock.message.stateRoot as Uint8Array);
}

/**
 * Returns new chainhead or null
 * @param config
 * @param db
 * @param forkChoice
 * @param block
 * @param newState
 */
export async function updateForkChoice(
  config: IBeaconConfig, db: IBeaconDb, forkChoice: ILMDGHOST, block: SignedBeaconBlock, newState: BeaconState
): Promise<Root|null> {
  forkChoice.addBlock({
    slot: block.message.slot,
    blockRootBuf: config.types.BeaconBlock.hashTreeRoot(block.message),
    stateRootBuf: block.message.stateRoot.valueOf() as Uint8Array,
    parentRootBuf: block.message.parentRoot.valueOf() as Uint8Array,
    justifiedCheckpoint: newState.currentJustifiedCheckpoint,
    finalizedCheckpoint: newState.finalizedCheckpoint
  });
  const currentRoot = await db.chain.getChainHeadRoot();
  const headRoot = forkChoice.headBlockRoot();
  if (currentRoot && !config.types.Root.equals(currentRoot, headRoot)) {
    const signedBlock = await db.block.get(headRoot);
    await db.updateChainHead(headRoot, signedBlock.message.stateRoot.valueOf() as Uint8Array);
    return headRoot;
  } else {
    return null;
  }
}

export async function runStateTransition(
  config: IBeaconConfig, db: IBeaconDb, logger: ILogger,
  preState: BeaconState, job: IBlockProcessJob
): Promise<BeaconState|null> {
  try {
    // if block is trusted don't verify state roots, proposer or signature
    return stateTransition(config, preState, job.signedBlock, !job.trusted, !job.trusted, !job.trusted);
  } catch (e) {
    const blockRoot = config.types.BeaconBlock.hashTreeRoot(job.signedBlock.message);
    // store block root in db and terminate
    await db.badBlock.put(blockRoot);
    logger.warn(`Found bad block with root: ${toHexString(blockRoot)} slot: ${job.signedBlock.message.slot}` +
      ` Error: ${e.message}`);
    return null;
  }
}
