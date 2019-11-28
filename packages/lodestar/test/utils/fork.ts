import {Fork} from "@chainsafe/eth2.0-types";
import {intToBytes} from "@chainsafe/eth2.0-utils";

/**
 * Generates a fake fork data test purposes.
 */
export function generateFork(): Fork {
  return {
    currentVersion: intToBytes(1, 4),
    previousVersion: intToBytes(0, 4),
    epoch: 1
  };
}
