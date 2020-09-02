import {IBlockProcessJob} from "../chain";
import {BeaconState, Root, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot, fastStateTransition} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../db/api";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {ILMDGHOST} from "../forkChoice";
import {BlockPool} from "./pool";
import {ChainEventEmitter} from "../emitter";
import {IStateContext} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
import {ITreeStateContext} from "../../db/api/beacon/stateContextCache";

export function processBlock(
  config: IBeaconConfig,
  logger: ILogger,
  db: IBeaconDb,
  forkChoice: ILMDGHOST,
  pool: BlockPool,
  eventBus: ChainEventEmitter
): (
  source: AsyncIterable<IBlockProcessJob>
) => AsyncGenerator<{
  preStateContext: ITreeStateContext;
  block: SignedBeaconBlock;
  postStateContext: ITreeStateContext;
  finalized: boolean;
}> {
  return (source) => {
    return (async function* () {
      for await (const job of source) {
        const blockRoot = config.types.BeaconBlock.hashTreeRoot(job.signedBlock.message);
        const preStateContext = await getPreState(config, db, forkChoice, pool, logger, job);
        if (!preStateContext) {
          logger.verbose("No pre-state found, dropping block", {
            slot: job.signedBlock.message.slot,
            blockRoot: toHexString(blockRoot),
            parentRoot: toHexString(job.signedBlock.message.parentRoot),
          });
          continue;
        }
        // Run the state transition
        const postStateContext = await runStateTransition(config, db, logger, preStateContext, job);
        if (!postStateContext) {
          continue;
        }
        const postTreeStateContext = postStateContext as ITreeStateContext;
        const newState = postTreeStateContext.state;
        // On successful transition, update system state
        if (job.reprocess) {
          await db.stateCache.add(postTreeStateContext);
        } else {
          await Promise.all([db.stateCache.add(postTreeStateContext), db.block.put(blockRoot, job.signedBlock)]);
        }

        const newChainHeadRoot = updateForkChoice(config, forkChoice, job.signedBlock, newState);
        if (config.types.Root.equals(newChainHeadRoot, blockRoot)) {
          logger.info("Processed new chain head", {
            newChainHeadRoot: toHexString(newChainHeadRoot),
            slot: newState.slot,
            epoch: computeEpochAtSlot(config, newState.slot),
          });
          eventBus.emit("forkChoice:head", forkChoice.head()!);
          if (!config.types.Fork.equals(preStateContext.state.fork, newState.fork)) {
            const epoch = computeEpochAtSlot(config, newState.slot);
            const currentVersion = newState.fork.currentVersion;
            logger.important(`Fork version changed to ${currentVersion} at slot ${newState.slot} and epoch ${epoch}`);
            eventBus.emit("forkVersion");
          }
        }
        pool.onProcessedBlock(job.signedBlock);
        yield {
          preStateContext,
          postStateContext: postTreeStateContext,
          block: job.signedBlock,
          finalized: job.trusted,
        };
      }
    })();
  };
}

export async function getPreState(
  config: IBeaconConfig,
  db: IBeaconDb,
  forkChoice: ILMDGHOST,
  pool: BlockPool,
  logger: ILogger,
  job: IBlockProcessJob
): Promise<ITreeStateContext | null> {
  const parentBlock = forkChoice.getBlockSummaryByBlockRoot(job.signedBlock.message.parentRoot.valueOf() as Uint8Array);
  if (!parentBlock) {
    const blockRoot = config.types.BeaconBlock.hashTreeRoot(job.signedBlock.message);
    logger.debug(
      `Block(${toHexString(blockRoot)}) at slot ${job.signedBlock.message.slot}` +
        ` is missing parent block (${toHexString(job.signedBlock.message.parentRoot)}).`
    );
    pool.addPendingBlock(job);
    return null;
  }
  return await db.stateCache.get(parentBlock.stateRoot as Uint8Array);
}

/**
 * Returns new chainhead
 * @param config
 * @param forkChoice
 * @param block
 * @param newState
 */
export function updateForkChoice(
  config: IBeaconConfig,
  forkChoice: ILMDGHOST,
  block: SignedBeaconBlock,
  newState: TreeBacked<BeaconState>
): Root {
  forkChoice.addBlock({
    slot: block.message.slot,
    blockRoot: config.types.BeaconBlock.hashTreeRoot(block.message),
    stateRoot: block.message.stateRoot.valueOf() as Uint8Array,
    parentRoot: block.message.parentRoot.valueOf() as Uint8Array,
    justifiedCheckpoint: newState.currentJustifiedCheckpoint,
    finalizedCheckpoint: newState.finalizedCheckpoint,
  });
  return forkChoice.headBlockRoot();
}

export async function runStateTransition(
  config: IBeaconConfig,
  db: IBeaconDb,
  logger: ILogger,
  stateContext: Required<IStateContext>,
  job: IBlockProcessJob
): Promise<IStateContext | null> {
  try {
    // if block is trusted don't verify proposer or op signature
    return fastStateTransition(stateContext, job.signedBlock, {
      verifyStateRoot: true,
      verifyProposer: !job.trusted,
      verifySignatures: !job.trusted,
    });
  } catch (e) {
    const blockRoot = config.types.BeaconBlock.hashTreeRoot(job.signedBlock.message);
    // store block root in db and terminate
    await db.badBlock.put(blockRoot);
    logger.warn(
      `Found bad block with root: ${toHexString(blockRoot)} slot: ${job.signedBlock.message.slot}` +
        ` Error: ${e.message}`
    );
    return null;
  }
}
