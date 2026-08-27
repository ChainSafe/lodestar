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
  // EIP-8198: scale by the slot duration ratio, dividing last so the exact ratio applies
  const slotDurationMs = getSlotDurationMsAtEpoch(config, epoch);
  return Math.floor(
    Math.floor((EFFECTIVE_BALANCE_INCREMENT * BASE_REWARD_FACTOR * slotDurationMs) / config.SLOT_DURATION_MS) /
      bnToNum(bigIntSqrt(BigInt(totalActiveStakeByIncrement) * BigInt(EFFECTIVE_BALANCE_INCREMENT)))
  );
}
