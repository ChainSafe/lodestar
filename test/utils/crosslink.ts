import {Crosslink, Epoch} from "../../src/types";
import {FAR_FUTURE_EPOCH, GENESIS_EPOCH, GENESIS_START_SHARD, ZERO_HASH} from "../../src/constants";
import {randBetween} from "./misc";

export function generateEmptyCrosslink(epoch: Epoch = GENESIS_EPOCH): Crosslink {
  return {
    shard: GENESIS_START_SHARD,
    startEpoch: epoch,
    endEpoch: FAR_FUTURE_EPOCH,
    parentRoot:ZERO_HASH,
    dataRoot: ZERO_HASH,
  };
}

export function crosslinkFromYaml(value: any): Crosslink {
  return {
    shard: value.shard.toNumber(),
    startEpoch: value.startEpoch.toNumber(),
    endEpoch: value.endEpoch.toNumber(),
    parentRoot: Buffer.from(value.parentRoot.slice(2), 'hex'),
    dataRoot: Buffer.from(value.dataRoot.slice(2), 'hex'),
  };
}
