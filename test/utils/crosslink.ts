import {Crosslink, Epoch} from "../../src/types";
import {GENESIS_EPOCH, ZERO_HASH} from "../../src/constants";

export function generateEmptyCrosslink(epoch: Epoch = GENESIS_EPOCH): Crosslink {
  return {
    epoch,
    previousCrosslinkRoot: ZERO_HASH,
    crosslinkDataRoot: ZERO_HASH,
  };
}

export function crosslinkFromYaml(value: any): Crosslink {
  return {
    epoch: value.epoch.toNumber(),
    previousCrosslinkRoot: Buffer.from(value.previousCrosslinkRoot.slice(2), 'hex'),
    crosslinkDataRoot: Buffer.from(value.crosslinkDataRoot.slice(2), 'hex'),
  };
}
