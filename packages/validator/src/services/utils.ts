import {SecretKey} from "@chainsafe/bls";
import {CommitteeIndex, SubCommitteeIndex} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {PubkeyHex, BLSKeypair} from "../types";
import {AttDutyAndProof} from "./attestationDuties";
import {SyncDutyAndProof} from "./syncCommitteeDuties";

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

export function groupAttDutiesByCommitteeIndex(duties: AttDutyAndProof[]): Map<CommitteeIndex, AttDutyAndProof[]> {
  const dutiesByCommitteeIndex = new Map<CommitteeIndex, AttDutyAndProof[]>();

  for (const dutyAndProof of duties) {
    const {committeeIndex} = dutyAndProof.duty;
    let dutyAndProofArr = dutiesByCommitteeIndex.get(committeeIndex);
    if (!dutyAndProofArr) {
      dutyAndProofArr = [];
      dutiesByCommitteeIndex.set(committeeIndex, dutyAndProofArr);
    }
    dutyAndProofArr.push(dutyAndProof);
  }

  return dutiesByCommitteeIndex;
}

export function groupSyncDutiesBySubCommitteeIndex(
  duties: SyncDutyAndProof[]
): Map<SubCommitteeIndex, SyncDutyAndProof[]> {
  const dutiesBySubCommitteeIndex = new Map<SubCommitteeIndex, SyncDutyAndProof[]>();

  for (const dutyAndProof of duties) {
    const subCommitteeIndex = dutyAndProof.subCommitteeIndex;
    let dutyAndProofArr = dutiesBySubCommitteeIndex.get(subCommitteeIndex);
    if (!dutyAndProofArr) {
      dutyAndProofArr = [];
      dutiesBySubCommitteeIndex.set(subCommitteeIndex, dutyAndProofArr);
    }
    dutyAndProofArr.push(dutyAndProof);
  }

  return dutiesBySubCommitteeIndex;
}
