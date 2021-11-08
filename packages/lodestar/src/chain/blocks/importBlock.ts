import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {readonlyValues, toHexString} from "@chainsafe/ssz";
import {getEffectiveBalances, merge} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice, OnBlockPrecachedData} from "@chainsafe/lodestar-fork-choice";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IMetrics} from "../../metrics";
import {IEth1ForBlockProduction} from "../../eth1";
import {IExecutionEngine} from "../../executionEngine";
import {IBeaconDb} from "../../db";
import {ZERO_HASH_HEX} from "../../constants";
import {IStateCacheRegen} from "../regen";
import {ChainEvent} from "../emitter";
import {ChainEventEmitter} from "../emitter";
import {getCheckpointFromState} from "./utils/checkpoint";
import {PendingEvents} from "./utils/pendingEvents";
import {FullyVerifiedBlock} from "./types";

export type ImportBlockModules = {
  db: IBeaconDb;
  eth1: IEth1ForBlockProduction;
  forkChoice: IForkChoice;
  regen: IStateCacheRegen;
  executionEngine: IExecutionEngine;
  emitter: ChainEventEmitter;
  config: IChainForkConfig;
  logger: ILogger;
  metrics: IMetrics | null;
};

/**
 * Imports a fully verified block into the chain state. Produces multiple permanent side-effects.
 *
 * Import block:
 * - Observe attestations
 * - Add validators to the pubkey cache
 * - Load shuffling caches
 * - Do weak subjectivy check
 * - Register block with fork-hoice
 * - Register state and block to the validator monitor
 * - For each attestation
 *   - Get indexed attestation
 *   - Register attestation with fork-choice
 *   - Register attestation with validator monitor (only after sync)
 * - Write block and state to hot db
 * - Write block and state to snapshot_cache
 * - head_tracker.register_block(block_root, parent_root, slot)
 * - Send events after everything is done
 */
export async function importBlock(chain: ImportBlockModules, fullyVerifiedBlock: FullyVerifiedBlock): Promise<void> {
  const {block, postState, skipImportingAttestations} = fullyVerifiedBlock;

  const pendingEvents = new PendingEvents(chain.emitter);

  // - Observe attestations
  // TODO
  // - Add validators to the pubkey cache
  // TODO
  // - Load shuffling caches
  // TODO
  // - Do weak subjectivy check
  // TODO

  // - Register block with fork-hoice

  // TODO IDEA: Lighthouse keeps a cache of checkpoint balances internally in the forkchoice store to be used latter
  // Ref: https://github.com/sigp/lighthouse/blob/f9bba92db3468321b28ddd9010e26b359f88bafe/beacon_node/beacon_chain/src/beacon_fork_choice_store.rs#L79
  //
  // current justified checkpoint should be prev epoch or current epoch if it's just updated
  // it should always have epochBalances there bc it's a checkpoint state, ie got through processEpoch
  const justifiedCheckpoint = postState.currentJustifiedCheckpoint;
  const onBlockPrecachedData: OnBlockPrecachedData = {};
  if (justifiedCheckpoint.epoch > chain.forkChoice.getJustifiedCheckpoint().epoch) {
    const state = chain.regen.getStateForJustifiedBalances(postState, toHexString(block.message.parentRoot));
    onBlockPrecachedData.justifiedBalances = getEffectiveBalances(state);
  }

  if (
    merge.isMergeStateType(postState) &&
    merge.isMergeBlockBodyType(block.message.body) &&
    merge.isMergeBlock(postState, block.message.body)
  ) {
    // pow_block = get_pow_block(block.body.execution_payload.parent_hash)
    const powBlockRootHex = toHexString(block.message.body.executionPayload.parentHash);
    const powBlock = await chain.eth1.getPowBlock(powBlockRootHex);
    if (!powBlock) throw Error(`merge block parent POW block not found ${powBlockRootHex}`);
    // pow_parent = get_pow_block(pow_block.parent_hash)
    const powBlockParent = await chain.eth1.getPowBlock(powBlock.parentHash);
    if (!powBlockParent) throw Error(`merge block parent's parent POW block not found ${powBlock.parentHash}`);
    onBlockPrecachedData.powBlock = powBlock;
    onBlockPrecachedData.powBlockParent = powBlockParent;
  }

  const prevFinalizedEpoch = chain.forkChoice.getFinalizedCheckpoint().epoch;
  const blockFC = chain.forkChoice.onBlock(block.message, postState, onBlockPrecachedData);

  // - Register state and block to the validator monitor
  // TODO

  // - For each attestation
  //   - Get indexed attestation
  //   - Register attestation with fork-choice
  //   - Register attestation with validator monitor (only after sync)
  // Only process attestations in response to an non-prefinalized block
  if (!skipImportingAttestations) {
    const attestations = Array.from(readonlyValues(block.message.body.attestations));

    for (const attestation of attestations) {
      try {
        const indexedAttestation = postState.epochCtx.getIndexedAttestation(attestation);
        chain.forkChoice.onAttestation(indexedAttestation);
        chain.metrics?.registerAttestationInBlock(indexedAttestation, block.message);
        pendingEvents.push(ChainEvent.attestation, attestation);
      } catch (e) {
        chain.logger.error("Error processing attestation from block", {slot: block.message.slot}, e as Error);
      }
    }
  }

  // - Write block and state to hot db
  // - Write block and state to snapshot_cache
  if (block.message.slot % SLOTS_PER_EPOCH === 0) {
    // Cache state to preserve epoch transition work
    const checkpointState = postState.clone();
    const cp = getCheckpointFromState(checkpointState);
    pendingEvents.push(ChainEvent.checkpoint, cp, checkpointState);
  }

  // Emit ChainEvent.forkChoiceHead event
  const oldHead = chain.forkChoice.getHead();
  chain.forkChoice.updateHead();
  const newHead = chain.forkChoice.getHead();
  if (newHead.blockRoot !== oldHead.blockRoot) {
    // new head
    pendingEvents.push(ChainEvent.forkChoiceHead, newHead);
    chain.metrics?.forkChoiceChangedHead.inc();

    const distance = chain.forkChoice.getCommonAncestorDistance(oldHead, newHead);
    if (distance !== null) {
      // chain reorg
      pendingEvents.push(ChainEvent.forkChoiceReorg, newHead, oldHead, distance);
      chain.metrics?.forkChoiceReorg.inc();
    }

    // MUST BE CALLED IF HEAD CHANGES !!! Otherwise the node will use the wrong state as head.
    // Currently the cannonical head information is split between `forkChoice.getHead()` to get just a summary, and
    // regen.getHeadState() to get the state of that head.
    //
    // Set head state in regen. May trigger async regen if the state is not in a memory cache
    chain.regen.setHead(newHead, postState);
  }

  // NOTE: forkChoice.fsStore.finalizedCheckpoint MUST only change is response to an onBlock event
  // Notify execution layer of head and finalized updates
  const currFinalizedEpoch = chain.forkChoice.getFinalizedCheckpoint().epoch;
  if (newHead.blockRoot !== oldHead.blockRoot || currFinalizedEpoch !== prevFinalizedEpoch) {
    /**
     * On post MERGE_EPOCH but pre TTD, blocks include empty execution payload with a zero block hash.
     * The consensus clients must not send notifyForkchoiceUpdate before TTD since the execution client will error.
     * So we must check that:
     * - `headBlockHash !== null` -> Pre MERGE_EPOCH
     * - `headBlockHash !== ZERO_HASH` -> Pre TTD
     */
    const headBlockHash = chain.forkChoice.getHead().executionPayloadBlockHash;
    /**
     * After MERGE_EPOCH and TTD it's okay to send a zero hash block hash for the finalized block. This will happen if
     * the current finalized block does not contain any execution payload at all (pre MERGE_EPOCH) or if it contains a
     * zero block hash (pre TTD)
     */
    const finalizedBlockHash = chain.forkChoice.getFinalizedBlock().executionPayloadBlockHash;
    if (headBlockHash !== null && headBlockHash !== ZERO_HASH_HEX) {
      chain.executionEngine.notifyForkchoiceUpdate(headBlockHash, finalizedBlockHash ?? ZERO_HASH_HEX).catch((e) => {
        chain.logger.error("Error pushing notifyForkchoiceUpdate()", {headBlockHash, finalizedBlockHash}, e);
      });
    }
  }

  // Emit ChainEvent.block event
  //
  // TODO: Move internal emitter onBlock() code here
  // MUST happen before any other block is processed
  // This adds the state necessary to process the next block
  chain.regen.addPostState(postState, blockFC);
  await chain.db.block.add(block);

  // - head_tracker.register_block(block_root, parent_root, slot)

  // - Send event after everything is done

  // Emit all events at once after fully completing importBlock()
  chain.emitter.emit(ChainEvent.block, block, postState);
  pendingEvents.emit();
}
