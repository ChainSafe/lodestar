import {ChainForkConfig} from "@lodestar/config";
import {AGGREGATORS_PER_COMMITTEE, ForkName, MIN_ATTESTATION_INCLUSION_DELAY_PQ} from "@lodestar/params";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {Logger, isErrorAborted, sleep} from "@lodestar/utils";
import {ClockEvent} from "../../util/clock.js";
import {IBeaconChain} from "../interface.js";
import {PqAttestationFilters, getPqAttestationFilters} from "../opPools/pqAttestationPool.js";
import {RegenCaller} from "../regen/index.js";

/**
 * How far into a slot the block the inclusion delay after it is prepared from: one aggregator's
 * delay after the last aggregator's aggregate is due, by when the slot's aggregates, the last
 * that block may include, have arrived.
 */
export function getPrepareStartMs(config: ChainForkConfig): number {
  return config.getAggregateDueMs(ForkName.pq, AGGREGATORS_PER_COMMITTEE);
}

/** How often the pool is asked whether it has more to merge */
export const PREPARE_INTERVAL_MS = 500;

/** What a block at a slot is built on, as of the head */
export type PqBlockHead = {root: RootHex; proposerIndex: ValidatorIndex; filters: PqAttestationFilters};

/** `last` if the head is still its own, else the same of the head now */
export async function getPqBlockHead(
  chain: IBeaconChain,
  blockSlot: Slot,
  last: PqBlockHead | null
): Promise<PqBlockHead> {
  const head = chain.forkChoice.getHead();
  if (last?.root === head.blockRoot) return last;
  const state = await chain.regen.getBlockSlotState(
    head,
    blockSlot,
    {dontTransferCache: true},
    RegenCaller.produceBlock
  );
  return {
    root: head.blockRoot,
    proposerIndex: state.getBeaconProposer(blockSlot),
    filters: getPqAttestationFilters(state, blockSlot),
  };
}

/**
 * Merging a block's attestation proofs takes seconds, which a proposer does not have in its slot.
 * For each slot one of this node's validators proposes, this has the pool merge them ahead of it,
 * and again as more attestations arrive or the head moves, until the slot starts.
 */
export class PqBlockPreparer {
  constructor(
    private readonly chain: IBeaconChain,
    private readonly config: ChainForkConfig,
    private readonly logger: Logger,
    private readonly signal: AbortSignal
  ) {
    this.chain.clock.on(ClockEvent.slot, this.prepareBlock);
    this.signal.addEventListener("abort", () => this.chain.clock.off(ClockEvent.slot, this.prepareBlock), {
      once: true,
    });
  }

  private prepareBlock = async (clockSlot: Slot): Promise<void> => {
    const blockSlot = clockSlot + MIN_ATTESTATION_INCLUSION_DELAY_PQ;
    // The clock ticks before genesis too
    if (clockSlot < 0 || this.config.getForkName(blockSlot) !== ForkName.pq) return;

    try {
      await sleep(getPrepareStartMs(this.config), this.signal);

      const slotStartMs = computeTimeAtSlot(this.config, blockSlot, this.chain.genesisTime) * 1000;
      let onHead: PqBlockHead | null = null;
      // Without validators there is no block to prepare, and no reason to dial a state
      while (Date.now() < slotStartMs && this.chain.beaconProposerCache.getValidatorIndices().length > 0) {
        onHead = await getPqBlockHead(this.chain, blockSlot, onHead);
        // The proposer of the slot may change with the head
        if (this.chain.beaconProposerCache.has(onHead.proposerIndex)) {
          await this.chain.pqAttestationPool.prepareBlock(blockSlot, onHead.filters, slotStartMs - Date.now());
        }
        await sleep(PREPARE_INTERVAL_MS, this.signal);
      }
    } catch (e) {
      if (!isErrorAborted(e)) this.logger.error("Failed to prepare pq attestations", {blockSlot}, e as Error);
    }
  };
}
