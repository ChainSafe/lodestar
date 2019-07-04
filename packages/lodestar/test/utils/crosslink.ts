import {Crosslink, Epoch} from "../../../types";
import {FAR_FUTURE_EPOCH, GENESIS_EPOCH, GENESIS_START_SHARD, ZERO_HASH} from "../../constants";

export function generateEmptyCrosslink(epoch: Epoch = GENESIS_EPOCH): Crosslink {
  return {
    shard: GENESIS_START_SHARD,
    startEpoch: epoch,
    endEpoch: epoch,
    parentRoot:ZERO_HASH,
    dataRoot: ZERO_HASH,
  };
}
