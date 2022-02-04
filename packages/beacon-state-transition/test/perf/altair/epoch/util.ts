import {CachedBeaconStateAltair} from "../../../../src";

export function mutateInactivityScores(state: CachedBeaconStateAltair, factorWithPositive: number): void {
  const vc = state.inactivityScores.length;
  for (let i = 0; i < vc; i++) {
    state.inactivityScores[i] = i < vc * factorWithPositive ? 100 : 0;
  }
}
