import {ChainForkConfig} from "@lodestar/config";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {interopDeposits} from "./interop/deposits.js";
import {InteropStateOpts, getInteropState} from "./interop/state.js";

/**
 * Builds state for `dev` command, for sim testing and some other tests
 */
export function initDevState(
  config: ChainForkConfig,
  validatorCount: number,
  interopStateOpts: InteropStateOpts
): BeaconStateAllForks {
  const deposits = interopDeposits(
    config,
    ssz.phase0.DepositDataRootList.defaultViewDU(),
    validatorCount,
    interopStateOpts
  );
  return getInteropState(config, interopStateOpts, deposits);
}
