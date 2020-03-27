import {IBlockProcessJob} from "../chain";
import {BeaconState, Root, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {stateTransition} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../db/api";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {ILMDGHOST} from "../forkChoice";
import {BlockPool} from "./pool";

export function processBlock(
  config: IBeaconConfig, db: IBeaconDb, logger: ILogger, forkChoice: ILMDGHOST, pool: BlockPool
): (source: AsyncIterable<IBlockProcessJob>) => AsyncGenerator<{block: SignedBeaconBlock; postState: BeaconState}> {
  return (source) => {
    return (async function*() {
      for await(const job of source) {
        const blockRoot = config.types.BeaconBlock.hashTreeRoot(job.signedBlock.message);
        const preState = await getPreState(config, db, pool, logger, job);
        if(!preState) {
          logger.error(`Missing prestate for block ${toHexString(blockRoot)}`);
          continue;
        }
        // Run the state transition
        let newState: BeaconState;
        const trusted = job.trusted;
        try {
          // if block is trusted don't verify state roots, proposer or signature
          newState = stateTransition(config, preState, job.signedBlock, !trusted, !trusted, !trusted);
        } catch (e) {
          // store block root in db and terminate
          await db.block.storeBadBlock(blockRoot);
          logger.warn(`Found bad block, block root: ${toHexString(blockRoot)} ` + e.message);
          return;
        }
        // On successful transition, update system state
        await Promise.all([
          db.state.set(job.signedBlock.message.stateRoot.valueOf() as Uint8Array, newState),
          db.block.set(blockRoot, job.signedBlock),
        ]);
        const newChainHeadRoot = await updateForkChoice(config, db, forkChoice, job.signedBlock, newState);
        if(newChainHeadRoot) {
          logger.important(`Fork choice changed head to 0x${toHexString(newChainHeadRoot)}`);
          await updateDepositMerkleTree(config, db, newState);
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
    logger.warn(`Block(${toHexString(blockRoot)}) at slot ${job.signedBlock.message.slot}`
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
  const headRoot = forkChoice.head();
  if (currentRoot && !config.types.Root.equals(currentRoot, headRoot)) {
    const signedBlock = await db.block.get(headRoot);
    await db.updateChainHead(headRoot, signedBlock.message.stateRoot.valueOf() as Uint8Array);
    return headRoot;
  } else {
    return null;
  }
}

export async function updateDepositMerkleTree(
  config: IBeaconConfig, db: IBeaconDb, newState: BeaconState
): Promise<void> {
  const upperIndex = newState.eth1DepositIndex + Math.min(
    config.params.MAX_DEPOSITS,
    newState.eth1Data.depositCount - newState.eth1DepositIndex
  );
  const [depositDatas, depositDataRootList] = await Promise.all([
    db.depositData.getAllBetween(newState.eth1DepositIndex, upperIndex),
    db.depositDataRootList.get(newState.eth1DepositIndex),
  ]);

  depositDataRootList.push(...depositDatas.map(config.types.DepositData.hashTreeRoot));
  //TODO: remove deposits with index <= newState.depositIndex
  await db.depositDataRootList.set(newState.eth1DepositIndex, depositDataRootList);
}