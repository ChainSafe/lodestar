import {MIN_SEED_LOOKAHEAD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateGloas, EpochTransitionCache} from "../types.js";
import {computeStartSlotAtEpoch} from "../util/epoch.js";
import {computePtc} from "../util/gloas.js";

export function processPtcWindow(state: CachedBeaconStateGloas, cache: EpochTransitionCache): void {
  const remainingPtcWindow = state.ptcWindow.getAllReadonlyValues().slice(SLOTS_PER_EPOCH);
  const epoch = state.epochCtx.epoch + MIN_SEED_LOOKAHEAD + 1;
  const startSlot = computeStartSlotAtEpoch(epoch);
  const nextEpochPtcWindow = new Array<number[]>(SLOTS_PER_EPOCH);

  for (let slotOffset = 0; slotOffset < SLOTS_PER_EPOCH; slotOffset++) {
    nextEpochPtcWindow[slotOffset] = Array.from(
      computePtc(state, startSlot + slotOffset, cache.nextShuffling ?? undefined)
    );
  }

  state.ptcWindow = ssz.gloas.PtcWindow.toViewDU([...remainingPtcWindow, ...nextEpochPtcWindow]);
}
