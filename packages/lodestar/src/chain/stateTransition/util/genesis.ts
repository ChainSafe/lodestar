import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {number64} from "@chainsafe/eth2.0-types";
import {intDiv} from "../../../util/math";

export function getCurrentSlot(config: IBeaconConfig, genesisTime: number64) {
  const diffInSeconds = (Date.now() / 1000) - genesisTime;
  return intDiv(diffInSeconds, config.params.SECONDS_PER_SLOT);
}