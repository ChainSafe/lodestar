import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {readonlyValues} from "@chainsafe/ssz";
import {getEffectiveBalances} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice, OnBlockPrecachedData} from "@chainsafe/lodestar-fork-choice";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IMetrics} from "../../metrics";
import {IBeaconDb} from "../../db";
import {CheckpointStateCache, StateContextCache, toCheckpointHex} from "../stateCache";
import {ChainEvent} from "../emitter";
import {ChainEventEmitter} from "../emitter";
import {getCheckpointFromState} from "./utils/checkpoint";
import {PendingEvents} from "./utils/pendingEvents";
import {FullyVerifiedBlock} from "./types";

export type ImportBlockModules = {
  db: IBeaconDb;
  forkChoice: IForkChoice;
  stateCache: StateContextCache;
  checkpointStateCache: CheckpointStateCache;
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
    const checkpointHex = toCheckpointHex(justifiedCheckpoint);
    const state = chain.checkpointStateCache.get(checkpointHex);
    if (state) {
      onBlockPrecachedData.justifiedBalances = getEffectiveBalances(state);
    } else {
      // TODO: Use regen to get the justified state. Send the block to the forkChoice immediately, and the balances
      // latter in case regen takes too much time.
      chain.logger.error("State not available for justified checkpoint", checkpointHex);
    }
  }

  // TODO: Figure out how to fetch for merge
  //  powBlock: undefined,
  //  powBlockParent: undefined,

  chain.forkChoice.onBlock(block.message, postState, onBlockPrecachedData);

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
    chain.checkpointStateCache.add(cp, checkpointState);
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
}
