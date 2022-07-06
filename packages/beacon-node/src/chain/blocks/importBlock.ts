import {altair, allForks, ssz} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {toHexString} from "@chainsafe/ssz";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateAltair,
  computeStartSlotAtEpoch,
  getEffectiveBalanceIncrementsZeroInactive,
  computeEpochAtSlot,
  RootCache,
} from "@lodestar/state-transition";
import {IForkChoice, OnBlockPrecachedData, ForkChoiceError, ForkChoiceErrorCode} from "@lodestar/fork-choice";
import {ILogger} from "@lodestar/utils";
import {IChainForkConfig} from "@lodestar/config";
import {IMetrics} from "../../metrics/index.js";
import {IExecutionEngine} from "../../execution/engine/interface.js";
import {IBeaconDb} from "../../db/index.js";
import {ZERO_HASH_HEX} from "../../constants/index.js";
import {CheckpointStateCache, StateContextCache, toCheckpointHex} from "../stateCache/index.js";
import {ChainEvent} from "../emitter.js";
import {ChainEventEmitter} from "../emitter.js";
import {LightClientServer} from "../lightClient/index.js";
import {SeenAggregatedAttestations} from "../seenCache/seenAggregateAndProof.js";
import {SeenBlockAttesters} from "../seenCache/seenBlockAttesters.js";
import {IEth1ForBlockProduction} from "../../eth1/index.js";
import {BeaconProposerCache} from "../beaconProposerCache.js";
import {IBeaconClock} from "../clock/index.js";
import {ReprocessController, REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC} from "../reprocess.js";
import {FullyVerifiedBlock} from "./types.js";
import {PendingEvents} from "./utils/pendingEvents.js";
import {getCheckpointFromState} from "./utils/checkpoint.js";

/**
 * Fork-choice allows to import attestations from current (0) or past (1) epoch.
 */
const FORK_CHOICE_ATT_EPOCH_LIMIT = 1;

export type ImportBlockModules = {
  db: IBeaconDb;
  forkChoice: IForkChoice;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
  seenAggregatedAttestations: SeenAggregatedAttestations;
  seenBlockAttesters: SeenBlockAttesters;
  beaconProposerCache: BeaconProposerCache;
  reprocessController: ReprocessController;
  lightClientServer: LightClientServer;
  eth1: IEth1ForBlockProduction;
  executionEngine: IExecutionEngine;
  emitter: ChainEventEmitter;
  config: IChainForkConfig;
  clock: IBeaconClock;
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
  const {block, postState, parentBlock, skipImportingAttestations, executionStatus} = fullyVerifiedBlock;
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

  const onBlockPrecachedData: OnBlockPrecachedData = {
    executionStatus,
    blockDelaySec: (Math.floor(Date.now() / 1000) - postState.genesisTime) % chain.config.SECONDS_PER_SLOT,
  };
  if (justifiedCheckpoint.epoch > chain.forkChoice.getJustifiedCheckpoint().epoch) {
    const state = getStateForJustifiedBalances(chain, postState, block);
    onBlockPrecachedData.justifiedBalances = getEffectiveBalanceIncrementsZeroInactive(state);
  }

  const prevFinalizedEpoch = chain.forkChoice.getFinalizedCheckpoint().epoch;
  chain.forkChoice.onBlock(block.message, postState, onBlockPrecachedData);

  // - Register state and block to the validator monitor
  // TODO

  const currentEpoch = computeEpochAtSlot(chain.forkChoice.getTime());
  const blockEpoch = computeEpochAtSlot(block.message.slot);

  // - For each attestation
  //   - Get indexed attestation
  //   - Register attestation with fork-choice
  //   - Register attestation with validator monitor (only after sync)
  // Only process attestations of blocks with relevant attestations for the fork-choice:
  // If current epoch is N, and block is epoch X, block may include attestations for epoch X or X - 1.
  // The latest block that is useful is at epoch N - 1 which may include attestations for epoch N - 1 or N - 2.
  if (!skipImportingAttestations && blockEpoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT) {
    const attestations = block.message.body.attestations;
    const rootCache = new RootCache(postState);
    const parentSlot = chain.forkChoice.getBlock(block.message.parentRoot)?.slot;
    const invalidAttestationErrorsByCode = new Map<string, {error: Error; count: number}>();

    for (const attestation of attestations) {
      try {
        const indexedAttestation = postState.epochCtx.getIndexedAttestation(attestation);
        const targetEpoch = attestation.data.target.epoch;

        const attDataRoot = toHexString(ssz.phase0.AttestationData.hashTreeRoot(indexedAttestation.data));
        chain.seenAggregatedAttestations.add(
          targetEpoch,
          attDataRoot,
          {aggregationBits: attestation.aggregationBits, trueBitCount: indexedAttestation.attestingIndices.length},
          true
        );
        // Duplicated logic from fork-choice onAttestation validation logic.
        // Attestations outside of this range will be dropped as Errors, so no need to import
        if (targetEpoch <= currentEpoch && targetEpoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT) {
          chain.forkChoice.onAttestation(indexedAttestation, attDataRoot);
        }

        // Note: To avoid slowing down sync, only register attestations within FORK_CHOICE_ATT_EPOCH_LIMIT
        chain.seenBlockAttesters.addIndices(blockEpoch, indexedAttestation.attestingIndices);

        if (parentSlot !== undefined) {
          chain.metrics?.registerAttestationInBlock(indexedAttestation, parentSlot, rootCache);
        }

        // don't want to log the processed attestations here as there are so many attestations and it takes too much disc space,
        // users may want to keep more log files instead of unnecessary processed attestations log
        // see https://github.com/ChainSafe/lodestar/pull/4032
        pendingEvents.push(ChainEvent.attestation, attestation);
      } catch (e) {
        // a block has a lot of attestations and it may has same error, we don't want to log all of them
        if (e instanceof ForkChoiceError && e.type.code === ForkChoiceErrorCode.INVALID_ATTESTATION) {
          let errWithCount = invalidAttestationErrorsByCode.get(e.type.err.code);
          if (errWithCount === undefined) {
            errWithCount = {error: e as Error, count: 1};
            invalidAttestationErrorsByCode.set(e.type.err.code, errWithCount);
          } else {
            errWithCount.count++;
          }
        } else {
          // always log other errors
          chain.logger.warn("Error processing attestation from block", {slot: block.message.slot}, e as Error);
        }
      }
    }

    for (const {error, count} of invalidAttestationErrorsByCode.values()) {
      chain.logger.warn(
        "Error processing attestations from block",
        {slot: block.message.slot, erroredAttestations: count},
        error
      );
    }
  }

  // - Write block and state to hot db
  // - Write block and state to snapshot_cache
  if (block.message.slot % SLOTS_PER_EPOCH === 0) {
    // Cache state to preserve epoch transition work
    const checkpointState = postState.clone();
    const cp = getCheckpointFromState(checkpointState);
    chain.checkpointStateCache.add(cp, checkpointState);
    pendingEvents.push(ChainEvent.checkpoint, cp, checkpointState);

    // Note: in-lined code from previos handler of ChainEvent.checkpoint
    chain.logger.verbose("Checkpoint processed", toCheckpointHex(cp));

    chain.metrics?.currentValidators.set(
      {status: "active"},
      checkpointState.epochCtx.currentShuffling.activeIndices.length
    );
    const parentBlockSummary = chain.forkChoice.getBlock(checkpointState.latestBlockHeader.parentRoot);

    if (parentBlockSummary) {
      const justifiedCheckpoint = checkpointState.currentJustifiedCheckpoint;
      const justifiedEpoch = justifiedCheckpoint.epoch;
      const preJustifiedEpoch = parentBlockSummary.justifiedEpoch;
      if (justifiedEpoch > preJustifiedEpoch) {
        chain.emitter.emit(ChainEvent.justified, justifiedCheckpoint, checkpointState);
        chain.logger.verbose("Checkpoint justified", toCheckpointHex(cp));
        chain.metrics?.previousJustifiedEpoch.set(checkpointState.previousJustifiedCheckpoint.epoch);
        chain.metrics?.currentJustifiedEpoch.set(cp.epoch);
      }
      const finalizedCheckpoint = checkpointState.finalizedCheckpoint;
      const finalizedEpoch = finalizedCheckpoint.epoch;
      const preFinalizedEpoch = parentBlockSummary.finalizedEpoch;
      if (finalizedEpoch > preFinalizedEpoch) {
        chain.emitter.emit(ChainEvent.finalized, finalizedCheckpoint, checkpointState);
        chain.logger.verbose("Checkpoint finalized", toCheckpointHex(cp));
        chain.metrics?.finalizedEpoch.set(cp.epoch);
      }
    }
  }

  // Emit ChainEvent.forkChoiceHead event
  const oldHead = chain.forkChoice.getHead();
  const newHead = chain.forkChoice.updateHead();
  const currFinalizedEpoch = chain.forkChoice.getFinalizedCheckpoint().epoch;

  if (newHead.blockRoot !== oldHead.blockRoot) {
    // new head
    pendingEvents.push(ChainEvent.forkChoiceHead, newHead);
    chain.metrics?.forkChoiceChangedHead.inc();

    const distance = chain.forkChoice.getCommonAncestorDistance(oldHead, newHead);
    if (distance !== null) {
      // chain reorg
      chain.metrics?.forkChoiceReorg.inc();
      chain.logger.verbose("Chain reorg", {
        depth: distance,
        previousHead: oldHead.blockRoot,
        previousHeadParent: oldHead.parentRoot,
        previousSlot: oldHead.slot,
        newHead: newHead.blockRoot,
        newHeadParent: newHead.parentRoot,
        newSlot: newHead.slot,
      });
      pendingEvents.push(ChainEvent.forkChoiceReorg, newHead, oldHead, distance);
      chain.metrics?.forkChoiceReorg.inc();
      chain.metrics?.forkChoiceReorgDistance.observe(distance);
    }

    // Lightclient server support (only after altair)
    // - Persist state witness
    // - Use block's syncAggregate
    if (blockEpoch >= chain.config.ALTAIR_FORK_EPOCH) {
      try {
        chain.lightClientServer.onImportBlockHead(
          block.message as altair.BeaconBlock,
          postState as CachedBeaconStateAltair,
          parentBlock
        );
      } catch (e) {
        chain.logger.error("Error lightClientServer.onImportBlock", {slot: block.message.slot}, e as Error);
      }
    }
  }

  // NOTE: forkChoice.fsStore.finalizedCheckpoint MUST only change in response to an onBlock event
  // Notifying EL of head and finalized updates as below is usually done within the 1st 4s of the slot.
  // If there is an advanced payload generation in the next slot, we'll notify EL again 4s before next
  // slot via PrepareNextSlotScheduler. There is no harm updating the ELs with same data, it will just ignore it.
  if (newHead.blockRoot !== oldHead.blockRoot || currFinalizedEpoch !== prevFinalizedEpoch) {
    /**
     * On post BELLATRIX_EPOCH but pre TTD, blocks include empty execution payload with a zero block hash.
     * The consensus clients must not send notifyForkchoiceUpdate before TTD since the execution client will error.
     * So we must check that:
     * - `headBlockHash !== null` -> Pre BELLATRIX_EPOCH
     * - `headBlockHash !== ZERO_HASH` -> Pre TTD
     */
    const headBlockHash = chain.forkChoice.getHead().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    /**
     * After BELLATRIX_EPOCH and TTD it's okay to send a zero hash block hash for the finalized block. This will happen if
     * the current finalized block does not contain any execution payload at all (pre MERGE_EPOCH) or if it contains a
     * zero block hash (pre TTD)
     */
    const safeBlockHash = chain.forkChoice.getJustifiedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    const finalizedBlockHash = chain.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    if (headBlockHash !== ZERO_HASH_HEX) {
      chain.executionEngine.notifyForkchoiceUpdate(headBlockHash, safeBlockHash, finalizedBlockHash).catch((e) => {
        chain.logger.error("Error pushing notifyForkchoiceUpdate()", {headBlockHash, finalizedBlockHash}, e);
      });
    }
  }

  // Emit ChainEvent.block event
  //
  // TODO: Move internal emitter onBlock() code here
  // MUST happen before any other block is processed
  // This adds the state necessary to process the next block
  chain.stateCache.add(postState);
  await chain.db.block.add(block);

  // - head_tracker.register_block(block_root, parent_root, slot)

  // - Send event after everything is done

  // Emit all events at once after fully completing importBlock()
  chain.emitter.emit(ChainEvent.block, block, postState);
  pendingEvents.emit();

  // Register stat metrics about the block after importing it
  chain.metrics?.parentBlockDistance.observe(block.message.slot - parentBlock.slot);

  // Note: in-lined from previous handler of ChainEvent.block
  const blockRoot = toHexString(chain.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message));
  const advancedSlot = chain.clock.slotWithFutureTolerance(REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC);

  chain.reprocessController.onBlockImported({slot: block.message.slot, root: blockRoot}, advancedSlot);

  chain.logger.verbose("Block processed", {
    slot: block.message.slot,
    root: blockRoot,
    delaySec: chain.clock.secFromSlot(block.message.slot),
  });
}

/**
 * Returns the closest state to postState.currentJustifiedCheckpoint in the same fork as postState
 *
 * From the spec https://github.com/ethereum/consensus-specs/blob/dev/specs/phase0/fork-choice.md#get_latest_attesting_balance
 * The state from which to read balances is:
 *
 * ```python
 * state = store.checkpoint_states[store.justified_checkpoint]
 * ```
 *
 * ```python
 * def store_target_checkpoint_state(store: Store, target: Checkpoint) -> None:
 *    # Store target checkpoint state if not yet seen
 *    if target not in store.checkpoint_states:
 *        base_state = copy(store.block_states[target.root])
 *        if base_state.slot < compute_start_slot_at_epoch(target.epoch):
 *            process_slots(base_state, compute_start_slot_at_epoch(target.epoch))
 *        store.checkpoint_states[target] = base_state
 * ```
 *
 * So the state to get justified balances is the post state of `checkpoint.root` dialed forward to the first slot in
 * `checkpoint.epoch` if that block is not in `checkpoint.epoch`.
 */
function getStateForJustifiedBalances(
  chain: ImportBlockModules,
  postState: CachedBeaconStateAllForks,
  block: allForks.SignedBeaconBlock
): CachedBeaconStateAllForks {
  const justifiedCheckpoint = postState.currentJustifiedCheckpoint;
  const checkpointHex = toCheckpointHex(justifiedCheckpoint);
  const checkpointSlot = computeStartSlotAtEpoch(checkpointHex.epoch);

  // First, check if the checkpoint block in the checkpoint epoch, by getting the block summary from the fork-choice
  const checkpointBlock = chain.forkChoice.getBlockHex(checkpointHex.rootHex);
  if (!checkpointBlock) {
    // Should never happen
    return postState;
  }

  // NOTE: The state of block checkpointHex.rootHex may be prior to the justified checkpoint if it was a skipped slot.
  if (checkpointBlock.slot >= checkpointSlot) {
    const checkpointBlockState = chain.stateCache.get(checkpointBlock.stateRoot);
    if (checkpointBlockState) {
      return checkpointBlockState;
    }
  }

  // If here, the first slot of `checkpoint.epoch` is a skipped slot. Check if the state is in the checkpoint cache.
  // NOTE: This state and above are correct with the spec.
  // NOTE: If the first slot of the epoch was skipped and the node is syncing, this state won't be in the cache.
  const state = chain.checkpointStateCache.get(checkpointHex);
  if (state) {
    return state;
  }

  // If it's not found, then find the oldest state in the same chain as this one
  // NOTE: If `block.message.parentRoot` is not in the fork-choice, `iterateAncestorBlocks()` returns `[]`
  // NOTE: This state is not be correct with the spec, it may have extra modifications from multiple blocks.
  //       However, it's a best effort before triggering an async regen process. In the future this should be fixed
  //       to use regen and get the correct state.
  let oldestState = postState;
  for (const parentBlock of chain.forkChoice.iterateAncestorBlocks(toHexString(block.message.parentRoot))) {
    // We want at least a state at the slot 0 of checkpoint.epoch
    if (parentBlock.slot < checkpointSlot) {
      break;
    }

    const parentBlockState = chain.stateCache.get(parentBlock.stateRoot);
    if (parentBlockState) {
      oldestState = parentBlockState;
    }
  }

  // TODO: Use regen to get correct state. Note that making this function async can break the import flow.
  //       Also note that it can dead lock regen and block processing since both have a concurrency of 1.

  chain.logger.error("State for currentJustifiedCheckpoint not available, using closest state", {
    checkpointEpoch: checkpointHex.epoch,
    checkpointRoot: checkpointHex.rootHex,
    stateSlot: oldestState.slot,
    stateRoot: toHexString(oldestState.hashTreeRoot()),
  });

  return oldestState;
}
