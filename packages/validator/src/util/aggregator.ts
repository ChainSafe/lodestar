import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {phase0, BLSSignature} from "@chainsafe/lodestar-types";
import {bytesToBigInt, intDiv} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";

export function isAttestationAggregator(
  config: IBeaconConfig,
  duty: Pick<phase0.AttesterDuty, "committeeLength">,
  slotSignature: BLSSignature
): boolean {
  const modulo = Math.max(1, intDiv(duty.committeeLength, config.params.TARGET_AGGREGATORS_PER_COMMITTEE));
  return bytesToBigInt(hash(slotSignature.valueOf() as Uint8Array).slice(0, 8)) % BigInt(modulo) === BigInt(0);
}

export function isSyncCommitteeAggregator(config: IBeaconConfig, selectionProof: BLSSignature): boolean {
  const {SYNC_COMMITTEE_SIZE, TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE} = config.params;

  const modulo = Math.max(
    1,
    intDiv(intDiv(SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT), TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE)
  );
  return bytesToBigInt(hash(selectionProof.valueOf() as Uint8Array).slice(0, 8)) % BigInt(modulo) === BigInt(0);
}
