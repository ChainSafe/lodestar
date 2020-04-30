import {Status} from "@chainsafe/lodestar-types";
import {ZERO_HASH} from "../../../../src/constants";

export function createStatus(): Status {
  return {
    finalizedEpoch: 1,
    finalizedRoot: ZERO_HASH,
    forkDigest: Buffer.alloc(4),
    headRoot: ZERO_HASH,
    headSlot: 10
  };
}