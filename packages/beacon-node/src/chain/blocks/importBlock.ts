import {altair, ssz} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {toHexString} from "@chainsafe/ssz";
import {CachedBeaconStateAltair, computeEpochAtSlot, RootCache} from "@lodestar/state-transition";
import {IForkChoice, ForkChoiceError, ForkChoiceErrorCode} from "@lodestar/fork-choice";
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
import {CheckpointBalancesCache} from "../balancesCache.js";
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
  checkpointBalancesCache: CheckpointBalancesCache;
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
  const {block, postState, parentBlockSlot, skipImportingAttestations, executionStatus} = fullyVerifiedBlock;
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
  const prevFinalizedEpoch = chain.forkChoice.getFinalizedCheckpoint().epoch;
  const blockDelaySec = (Math.floor(Date.now() / 1000) - postState.genesisTime) % chain.config.SECONDS_PER_SLOT;
  const blockRoot = toHexString(chain.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message));
  // Should compute checkpoint balances before forkchoice.onBlock
  chain.checkpointBalancesCache.processState(blockRoot, postState);
  chain.forkChoice.onBlock(block.message, postState, blockDelaySec, executionStatus);

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
          parentBlockSlot
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
  chain.metrics?.parentBlockDistance.observe(block.message.slot - parentBlockSlot);
  chain.metrics?.proposerBalanceDiffAny.observe(fullyVerifiedBlock.proposerBalanceDiff);
  chain.metrics?.registerImportedBlock(block.message, fullyVerifiedBlock);

  const advancedSlot = chain.clock.slotWithFutureTolerance(REPROCESS_MIN_TIME_TO_NEXT_SLOT_SEC);

  chain.reprocessController.onBlockImported({slot: block.message.slot, root: blockRoot}, advancedSlot);

  chain.logger.verbose("Block processed", {
    slot: block.message.slot,
    root: blockRoot,
    delaySec: chain.clock.secFromSlot(block.message.slot),
  });
}
