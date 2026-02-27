import {ssz} from "@lodestar/types";
import {CachedBeaconStateFulu, getCachedBeaconState} from "../cache/stateCache.js";

type CachedBeaconStateEip7782 = CachedBeaconStateFulu;

export function upgradeStateToEip7782(stateFulu: CachedBeaconStateFulu): CachedBeaconStateEip7782 {
  const {config} = stateFulu;
  const eip7782Ssz = (ssz as typeof ssz & {eip7782?: typeof ssz.fulu}).eip7782 ?? ssz.fulu;
  const stateFuluNode = ssz.fulu.BeaconState.commitViewDU(stateFulu);
  const stateEip7782View = eip7782Ssz.BeaconState.getViewDU(stateFuluNode);
  const stateEip7782 = getCachedBeaconState(stateEip7782View, stateFulu);

  stateEip7782.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateFulu.fork.currentVersion,
    currentVersion: config.EIP7782_FORK_VERSION,
    epoch: stateFulu.epochCtx.epoch,
  });

  stateEip7782.commit();
  // Clear cache to ensure the cache of fulu fields is not used by new eip7782 fields
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateEip7782["clearCache"]();

  return stateEip7782;
}
