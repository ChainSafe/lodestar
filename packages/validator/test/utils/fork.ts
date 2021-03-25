import {phase0} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";

/**
 * Generates a fake fork data test purposes.
 */
export function generateFork(): phase0.Fork {
  return {
    currentVersion: intToBytes(1, 4),
    previousVersion: intToBytes(0, 4),
    epoch: 1,
  };
}
