import {altair} from "../../../../src";
import {CachedBeaconState} from "../../../../src/allForks";

export function mutateInactivityScores(state: CachedBeaconState<altair.BeaconState>, factorWithPositive: number): void {
  const vc = state.inactivityScores.length;
  for (let i = 0; i < vc; i++) {
    state.inactivityScores[i] = i < vc * factorWithPositive ? 100 : 0;
  }
}
