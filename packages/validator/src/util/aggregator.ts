import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  SYNC_COMMITTEE_SIZE,
  SYNC_COMMITTEE_SUBNET_COUNT,
  TARGET_AGGREGATORS_PER_COMMITTEE,
  TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE,
} from "@chainsafe/lodestar-params";
import {BLSSignature} from "@chainsafe/lodestar-types";
import {bytesToBigInt, intDiv} from "@chainsafe/lodestar-utils";
import {routes} from "@chainsafe/lodestar-api";
import {hash} from "@chainsafe/ssz";

export function isAttestationAggregator(
  config: IBeaconConfig,
  duty: Pick<routes.validator.AttesterDuty, "committeeLength">,
  slotSignature: BLSSignature
): boolean {
  const modulo = Math.max(1, intDiv(duty.committeeLength, TARGET_AGGREGATORS_PER_COMMITTEE));
  return bytesToBigInt(hash(slotSignature.valueOf() as Uint8Array).slice(0, 8)) % BigInt(modulo) === BigInt(0);
}

export function isSyncCommitteeAggregator(selectionProof: BLSSignature): boolean {
  const modulo = Math.max(
    1,
    intDiv(intDiv(SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT), TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE)
  );
  return bytesToBigInt(hash(selectionProof.valueOf() as Uint8Array).slice(0, 8)) % BigInt(modulo) === BigInt(0);
}
