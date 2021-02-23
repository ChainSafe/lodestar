import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, BLSSignature, Number64} from "@chainsafe/lodestar-types";
import {bytesToBigInt, intDiv} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";

export function isValidatorAggregator(slotSignature: BLSSignature, modulo: Number64): boolean {
  return bytesToBigInt(hash(slotSignature.valueOf() as Uint8Array).slice(0, 8)) % BigInt(modulo) === BigInt(0);
}

export function getAggregatorModulo(config: IBeaconConfig, duty: phase0.AttesterDuty): number {
  return Math.max(1, intDiv(duty.committeeLength, config.params.TARGET_AGGREGATORS_PER_COMMITTEE));
}
