import {Crosslink, Epoch} from "@chainsafe/eth2.0-types";
import {FAR_FUTURE_EPOCH, GENESIS_EPOCH, GENESIS_START_SHARD, ZERO_HASH} from "@chainsafe/eth2.0-constants";

export function generateEmptyCrosslink(epoch: Epoch = GENESIS_EPOCH): Crosslink {
  return {
    shard: GENESIS_START_SHARD,
    startEpoch: epoch,
    endEpoch: epoch,
    parentRoot:ZERO_HASH,
    dataRoot: ZERO_HASH,
  };
}
