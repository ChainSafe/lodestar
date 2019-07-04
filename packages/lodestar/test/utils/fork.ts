import {Fork} from "../../../types";
import {intToBytes} from "../../util/bytes";

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
