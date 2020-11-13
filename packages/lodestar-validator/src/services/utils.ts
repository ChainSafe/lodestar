import {AttesterDuty} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export function getAggregatorModulo(config: IBeaconConfig, duty: AttesterDuty): number {
  return Math.max(1, intDiv(duty.committeeLength, config.params.TARGET_COMMITTEE_SIZE));
}
