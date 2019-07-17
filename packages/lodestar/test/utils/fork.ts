import {Fork} from "@chainsafe/eth2-types";
import {intToBytes} from "../../src/util/bytes";

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
