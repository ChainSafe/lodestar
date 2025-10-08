import {Slot} from "@lodestar/types";
import {HierarchicalLayers} from "./hierarchicalLayers.ts";

export type StateRegenPlan = {
  targetSlot: Slot;
  snapshotSlot: Slot;
  diffSlots: Slot[];
  blockReplay?: {fromSlot: Slot; tillSlot: Slot};
};

export function buildStateRegenPlan(layers: HierarchicalLayers, target: Slot): StateRegenPlan {
  const path = layers.computeSlotPath(target);
  const [snapshotSlot, ...diffSlots] = path;
  const lastDiffSlot = diffSlots.at(-1);

  if (target === lastDiffSlot || target === snapshotSlot) {
    return {
      snapshotSlot,
      diffSlots,
      blockReplay: undefined,
      targetSlot: target,
    };
  }

  return {
    snapshotSlot,
    diffSlots,
    blockReplay: {
      fromSlot: lastDiffSlot ? lastDiffSlot + 1 : snapshotSlot + 1,
      tillSlot: target,
    },
    targetSlot: target,
  };
}
