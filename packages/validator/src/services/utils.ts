import {SecretKey} from "@chainsafe/bls";
import {CommitteeIndex} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {PubkeyHex, BLSKeypair} from "../types";
import {DutyAndProof} from "./attestationDuties";

export function mapSecretKeysToValidators(secretKeys: SecretKey[]): Map<PubkeyHex, BLSKeypair> {
  const validators: Map<PubkeyHex, BLSKeypair> = new Map<PubkeyHex, BLSKeypair>();
  for (const secretKey of secretKeys) {
    const publicKey = secretKey.toPublicKey().toBytes();
    validators.set(toHexString(publicKey), {publicKey, secretKey});
  }
  return validators;
}

export function getAggregationBits(committeeLength: number, validatorIndexInCommittee: number): boolean[] {
  return Array.from({length: committeeLength}, (_, i) => i === validatorIndexInCommittee);
}

export function groupDutiesByCommitteeIndex(duties: DutyAndProof[]): Map<CommitteeIndex, DutyAndProof[]> {
  const dutiesByCommitteeIndex = new Map<CommitteeIndex, DutyAndProof[]>();

  for (const dutyAndProof of duties) {
    const {committeeIndex} = dutyAndProof.duty;
    const dutyAndProofArr = dutiesByCommitteeIndex.get(committeeIndex);
    if (dutyAndProofArr) {
      dutyAndProofArr.push(dutyAndProof);
    } else {
      dutiesByCommitteeIndex.set(committeeIndex, [dutyAndProof]);
    }
  }

  return dutiesByCommitteeIndex;
}
