import {ChainConfig} from "@lodestar/config";
import {BASE_REWARD_FACTOR, EFFECTIVE_BALANCE_INCREMENT} from "@lodestar/params";
import {Epoch} from "@lodestar/types";
import {bigIntSqrt, bnToNum} from "@lodestar/utils";
import {getSlotDurationMsAtEpoch} from "./slot.js";

/**
 * Before we manage bigIntSqrt(totalActiveStake) as BigInt and return BigInt.
 * bigIntSqrt(totalActiveStake) should fit a number (2 ** 53 -1 max)
 **/
export function computeBaseRewardPerIncrement(
  config: ChainConfig,
  epoch: Epoch,
  totalActiveStakeByIncrement: number
): number {
  // Divide last so the exact slot duration ratio applies
  const numerator = Math.floor(
    (EFFECTIVE_BALANCE_INCREMENT * BASE_REWARD_FACTOR * getSlotDurationMsAtEpoch(config, epoch)) /
      config.SLOT_DURATION_MS
  );
  return Math.floor(
    numerator / bnToNum(bigIntSqrt(BigInt(totalActiveStakeByIncrement) * BigInt(EFFECTIVE_BALANCE_INCREMENT)))
  );
}
