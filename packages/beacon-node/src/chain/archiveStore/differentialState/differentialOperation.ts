import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {BeaconConfig} from "@lodestar/config";
import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../../db/interface.js";
import {IStateDiffCodec} from "../interface.js";
import {replayBlocks} from "../utils/replayBlocks.js";
import {HierarchicalLayers} from "./hierarchicalLayers.js";
import {BeaconStateSnapshot} from "./ssz.js";
import {getStateDifferentials, replayStateDifferentials} from "./stateDifferential.js";
import {beaconStateBytesToSnapshot, getStateSnapshot, snapshotToBeaconStateBytes} from "./stateSnapshot.js";

type DifferentialStateOperation = {
  snapshotSlot: Slot;
  diffSlots: Slot[];
  blockReplay?: {
    fromSlot: Slot;
    tillSlot: Slot;
  };
};

export async function processDifferentialOperation(
  modules: {
    pubkey2index: PubkeyIndexMap;
    logger?: Logger;
    db: IBeaconDb;
    codec: IStateDiffCodec;
    config: BeaconConfig;
  },
  operation: DifferentialStateOperation,
  opts?: {fallbackSnapshot?: boolean}
): Promise<BeaconStateSnapshot | null> {
  const {logger, db, codec, config} = modules;
  const {snapshotSlot, diffSlots, blockReplay} = operation;

  logger?.verbose("Processing differential state operation", {
    snapshotSlot,
    diffSlots: diffSlots.join(","),
    blockReplayFrom: blockReplay?.fromSlot,
    blockReplayTill: blockReplay?.tillSlot,
  });

  // 1. First step is to fetch the snapshot state
  const stateSnapshot = await getStateSnapshot({db}, {slot: snapshotSlot, fallback: opts?.fallbackSnapshot ?? false});

  if (!stateSnapshot) {
    throw new Error(`Can not find state snapshot for slot=${snapshotSlot}`);
  }

  if (snapshotSlot !== stateSnapshot.slot) {
    logger?.warn("Expected snapshot not found", {
      expectedSnapshotSlot: snapshotSlot,
      availableSnapshotSlot: stateSnapshot.slot,
    });
  }

  // We don't have any diffs and block replay
  if (diffSlots.length === 0 && !blockReplay) {
    return stateSnapshot;
  }

  // 2. Fetch all diff states
  const nonEmptyDiffs = await getStateDifferentials({db}, {slots: diffSlots});
  if (nonEmptyDiffs.length < diffSlots.length) {
    logger?.warn("Missing some diff states", {
      snapshotSlot: stateSnapshot.slot,
      diffPath: diffSlots.join(","),
      availableDiffs: nonEmptyDiffs.map((d) => d.slot).join(","),
    });
  }

  const lastDiffSlot = nonEmptyDiffs.at(-1)?.slot;
  if (!lastDiffSlot) {
    throw new Error(`Can not find any required diffs ${diffSlots.join(",")}`);
  }

  // 3. Replay state diff on top of snapshot
  logger?.verbose("Replaying state diffs", {
    snapshotSlot,
    diffPath: diffSlots.join(","),
    availableDiffs: nonEmptyDiffs.map((d) => d.slot).join(","),
  });

  const stateWithDiffApplied = await replayStateDifferentials(
    {codec, logger},
    {stateDifferentials: nonEmptyDiffs, stateSnapshot}
  );

  if (stateWithDiffApplied.stateBytes.byteLength === 0 || stateWithDiffApplied.balancesBytes.byteLength === 0) {
    throw new Error(
      `Invalid state after applying diffs: 
      stateBytesSize=${stateWithDiffApplied.stateBytes.byteLength},
      balancesBytesSize=${stateWithDiffApplied.balancesBytes.byteLength}`
    );
  }

  // There is no blocks to replay
  if (!blockReplay) return stateWithDiffApplied;

  const stateBytes = snapshotToBeaconStateBytes({config}, stateWithDiffApplied);

  // 4. Replay blocks
  const stateWithBlockReplay = await replayBlocks(modules, {
    toSlot: blockReplay.tillSlot,
    fromSlot: lastDiffSlot,
    stateBytes,
  });

  return beaconStateBytesToSnapshot({config}, blockReplay.tillSlot, stateWithBlockReplay);
}

/**
 * Get the operation required to reach a target slot
 * @internal
 */
export function getDifferentialOperation(
  modules: {layers: HierarchicalLayers},
  slot: Slot
): DifferentialStateOperation {
  const {layers} = modules;

  const path = layers.computeSlotPath(slot);
  const snapshotSlot = path[0];
  const diffSlots = path.slice(1);
  const lastDiffSlot = diffSlots.at(-1);

  if (slot === lastDiffSlot || slot === snapshotSlot) {
    return {
      snapshotSlot,
      diffSlots,
      blockReplay: undefined,
    };
  }

  return {
    snapshotSlot,
    diffSlots,
    blockReplay: {
      fromSlot: lastDiffSlot ? lastDiffSlot + 1 : snapshotSlot + 1,
      tillSlot: slot,
    },
  };
}
