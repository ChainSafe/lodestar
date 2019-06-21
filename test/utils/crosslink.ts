import {Crosslink, Epoch} from "../../src/types";
import {FAR_FUTURE_EPOCH, GENESIS_EPOCH, GENESIS_START_SHARD, ZERO_HASH} from "../../src/constants";
import {randBetween} from "./misc";

export function generateEmptyCrosslink(epoch: Epoch = GENESIS_EPOCH): Crosslink {
  return {
    startEpoch: epoch,
    endEpoch: FAR_FUTURE_EPOCH,
    parentRoot:ZERO_HASH,
    dataRoot: ZERO_HASH,
    shard: GENESIS_START_SHARD,
  };
}

export function crosslinkFromYaml(value: any): Crosslink {
  return {
    startEpoch: value.epoch.toNumber(),
    endEpoch: value.epoch.toNumber(),
    parentRoot: Buffer.from(value.previousCrosslinkRoot.slice(2), 'hex'),
    dataRoot: Buffer.from(value.crosslinkDataRoot.slice(2), 'hex'),
    shard: randBetween(0, 1024),
  };
}
