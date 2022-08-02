import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {toHex} from "@lodestar/utils";
import {downloadHeadState} from "./downloadHeadState.js";

/* eslint-disable no-console */

const {state} = await downloadHeadState();

const fromSlot = Math.max(state.slot - SLOTS_PER_HISTORICAL_ROOT, 0);

const uniqueRootsPerEpoch = new Map<number, number>();
let prevRoot = "0x0";

for (let slot = fromSlot; slot < state.slot; slot++) {
  const root = toHex(state.blockRoots[slot % SLOTS_PER_HISTORICAL_ROOT]);
  console.log(slot, root);

  const epoch = computeEpochAtSlot(slot);

  if (slot % SLOTS_PER_EPOCH === 0) {
    uniqueRootsPerEpoch.set(epoch, 0);
  }

  if (root !== prevRoot) {
    uniqueRootsPerEpoch.set(epoch, 1 + (uniqueRootsPerEpoch.get(epoch) ?? 0));
  }

  prevRoot = root;
}

console.log(uniqueRootsPerEpoch);
