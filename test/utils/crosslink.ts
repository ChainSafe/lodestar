import {Crosslink, Epoch} from "../../src/types";
import {FAR_FUTURE_EPOCH, GENESIS_EPOCH, GENESIS_START_SHARD, ZERO_HASH} from "../../src/constants";

export function generateEmptyCrosslink(epoch: Epoch = GENESIS_EPOCH): Crosslink {
  return {
    shard: GENESIS_START_SHARD,
    startEpoch: epoch,
    endEpoch: FAR_FUTURE_EPOCH,
    parentRoot:ZERO_HASH,
    dataRoot: ZERO_HASH,
  };
}
