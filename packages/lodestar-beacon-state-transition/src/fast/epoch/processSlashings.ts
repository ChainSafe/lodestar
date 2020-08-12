import {readOnlyMap} from "@chainsafe/ssz";
import {BeaconState} from "@chainsafe/lodestar-types";
import {bigIntMin} from "@chainsafe/lodestar-utils";

import {decreaseBalance} from "../../util";
import {EpochContext, IEpochProcess} from "../util";


export function processSlashings(
  epochCtx: EpochContext,
  process: IEpochProcess,
  state: BeaconState
): void {
  const totalBalance = process.totalActiveStake;
  const totalSlashings = readOnlyMap(state.slashings, (s) => s).reduce((a, b) => a + b, BigInt(0));
  const slashingsScale = bigIntMin(totalSlashings * BigInt(3), totalBalance);
  const increment = BigInt(epochCtx.config.params.EFFECTIVE_BALANCE_INCREMENT);
  process.indicesToSlash.forEach((index) => {
    const effectiveBalance = process.statuses[index].validator.effectiveBalance;
    const penaltyNumerator = effectiveBalance / increment * slashingsScale;
    const penalty = penaltyNumerator / totalBalance * increment;
    decreaseBalance(state, index, penalty);
  });
}
