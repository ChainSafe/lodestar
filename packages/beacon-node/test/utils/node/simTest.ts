import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  CachedBeaconStateAllForks,
  beforeProcessEpoch,
} from "@lodestar/state-transition";
import {IBeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {allForks, Epoch, Slot} from "@lodestar/types";
import {Checkpoint} from "@lodestar/types/phase0";
import {ILogger, mapValues} from "@lodestar/utils";
import {toHexString} from "@chainsafe/ssz";
import {BeaconNode} from "../../../src/index.js";
import {ChainEvent, HeadEventData} from "../../../src/chain/index.js";
import {linspace} from "../../../src/util/numpy.js";
import {RegenCaller} from "../../../src/chain/regen/index.js";

/* eslint-disable no-console */

export function simTestInfoTracker(bn: BeaconNode, logger: ILogger): () => void {
  let lastSeenEpoch = 0;

  const attestationsPerBlock = new Map<Slot, number>();
  const inclusionDelayPerBlock = new Map<Slot, number>();
  const prevParticipationPerEpoch = new Map<Epoch, number>();
  const currParticipationPerEpoch = new Map<Epoch, number>();

  async function onHead(head: HeadEventData): Promise<void> {
    const slot = head.slot;

    // For each block
    // Check if there was a proposed block and how many attestations it includes
    const block = await bn.chain.getCanonicalBlockAtSlot(head.slot);
    if (block) {
      const bits = sumAttestationBits(block.message);
      const inclDelay = avgInclusionDelay(block.message);
      attestationsPerBlock.set(slot, bits);
      inclusionDelayPerBlock.set(slot, inclDelay);
      logger.info("> Block attestations", {slot, bits, inclDelay});
    }
  }

  function logParticipation(state: CachedBeaconStateAllForks): void {
    // Compute participation (takes 5ms with 64 validators)
    // Need a CachedBeaconStateAllForks where (state.slot + 1) % SLOTS_EPOCH == 0
    const epochProcess = beforeProcessEpoch(state);
    const epoch = computeEpochAtSlot(state.slot);

    const prevParticipation =
      epochProcess.prevEpochUnslashedStake.targetStakeByIncrement / epochProcess.totalActiveStakeByIncrement;
    const currParticipation =
      epochProcess.currEpochUnslashedTargetStakeByIncrement / epochProcess.totalActiveStakeByIncrement;
    prevParticipationPerEpoch.set(epoch - 1, prevParticipation);
    currParticipationPerEpoch.set(epoch, currParticipation);
    logger.info("> Participation", {
      slot: `${state.slot}/${computeEpochAtSlot(state.slot)}`,
      prev: prevParticipation,
      curr: currParticipation,
    });
  }

  async function onCheckpoint(checkpoint: Checkpoint): Promise<void> {
    // Skip epochs on duplicated checkpoint events
    if (checkpoint.epoch <= lastSeenEpoch) return;
    lastSeenEpoch = checkpoint.epoch;

    // Recover the pre-epoch transition state, use any random caller for regen
    const checkpointState = await bn.chain.regen.getCheckpointState(checkpoint, RegenCaller.onForkChoiceFinalized);
    const lastSlot = computeStartSlotAtEpoch(checkpoint.epoch) - 1;
    const lastStateRoot = checkpointState.stateRoots.get(lastSlot % SLOTS_PER_HISTORICAL_ROOT);
    const lastState = await bn.chain.regen.getState(toHexString(lastStateRoot), RegenCaller.onForkChoiceFinalized);
    logParticipation(lastState);
  }

  bn.chain.emitter.on(ChainEvent.head, onHead);
  bn.chain.emitter.on(ChainEvent.checkpoint, onCheckpoint);

  return function stop() {
    bn.chain.emitter.off(ChainEvent.head, onHead);
    bn.chain.emitter.off(ChainEvent.checkpoint, onCheckpoint);

    // Write report
    console.log("\nEnd of sim test report\n");
    printEpochSlotGrid(attestationsPerBlock, bn.config, "Attestations per block");
    printEpochSlotGrid(inclusionDelayPerBlock, bn.config, "Inclusion delay per block");
    printEpochGrid({curr: currParticipationPerEpoch, prev: prevParticipationPerEpoch}, "Participation per epoch");
  };
}

function sumAttestationBits(block: allForks.BeaconBlock): number {
  return Array.from(block.body.attestations).reduce(
    (total, att) => total + att.aggregationBits.getTrueBitIndexes().length,
    0
  );
}

function avgInclusionDelay(block: allForks.BeaconBlock): number {
  const inclDelay = Array.from(block.body.attestations).map((att) => block.slot - att.data.slot);
  return avg(inclDelay);
}

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((p, c) => p + c, 0) / arr.length;
}

/**
 * Print a table grid of (Y) epoch / (X) slot_per_epoch
 */
function printEpochSlotGrid<T>(map: Map<Slot, T>, config: IBeaconConfig, title: string): void {
  const lastSlot = Array.from(map.keys())[map.size - 1];
  const lastEpoch = computeEpochAtSlot(lastSlot);
  const rowsByEpochBySlot = linspace(0, lastEpoch).map((epoch) => {
    const slots = linspace(epoch * SLOTS_PER_EPOCH, (epoch + 1) * SLOTS_PER_EPOCH - 1);
    return slots.map((slot) => formatValue(map.get(slot)));
  });
  console.log(renderTitle(title));
  console.table(rowsByEpochBySlot);
}

/**
 * Print a table grid of (Y) maps object key / (X) epoch
 */
function printEpochGrid(maps: Record<string, Map<Epoch, number>>, title: string): void {
  const lastEpoch = Object.values(maps).reduce((max, map) => {
    const epoch = Array.from(map.keys())[map.size - 1];
    return epoch > max ? epoch : max;
  }, 0);
  const epochGrid = linspace(0, lastEpoch).map((epoch) =>
    mapValues(maps, (val, key) => formatValue(maps[key].get(epoch)))
  );
  console.log(renderTitle(title));
  console.table(epochGrid);
}

function renderTitle(title: string): string {
  return `${title}\n${"=".repeat(title.length)}`;
}

/** Represent undefined values as "-" to make the tables shorter. The word "undefined" is too wide */
function formatValue<T>(val: T | undefined): T | string {
  return val === undefined ? "-" : val;
}
