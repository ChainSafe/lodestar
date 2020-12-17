import {AttesterDuty, BLSPubkey} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SecretKey} from "@chainsafe/bls";

/**
 * Return the modulo needed to calculate whether the validator is an aggregator.
 */
export function getAggregatorModulo(config: IBeaconConfig, duty: AttesterDuty): number {
  return Math.max(1, intDiv(duty.committeeLength, config.params.TARGET_COMMITTEE_SIZE));
}

export function getAggregationBits(committeeLength: number, validatorIndexInCommittee: number): boolean[] {
  return Array.from({length: committeeLength}, (_, i) => i === validatorIndexInCommittee);
}

export function getPubKeyIndex(
  config: IBeaconConfig,
  search: BLSPubkey,
  validatorData: {publicKey: BLSPubkey; secretKey: SecretKey}[]
): number {
  return validatorData.findIndex((vd) => config.types.BLSPubkey.equals(vd.publicKey, search));
}
