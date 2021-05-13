import {SecretKey} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
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
      dutiesByCommitteeIndex.set(committeeIndex, []);
    }
    dutyAndProofArr.push(dutyAndProof);
  }

  return dutiesByCommitteeIndex;
}

export function groupSyncDutiesBySubCommitteeIndex(
  config: IBeaconConfig,
  duties: SyncDutyAndProof[]
): Map<SubCommitteeIndex, SyncDutyAndProof[]> {
  const dutiesBySubCommitteeIndex = new Map<SubCommitteeIndex, SyncDutyAndProof[]>();

  // TODO: Cache this value
  const SYNC_COMMITTEE_SUBNET_SIZE = Math.floor(config.params.SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);

  for (const dutyAndProof of duties) {
    for (const committeeIndex of dutyAndProof.duty.validatorSyncCommitteeIndices) {
      const subCommitteeIndex = Math.floor(committeeIndex / SYNC_COMMITTEE_SUBNET_SIZE);
      let dutyAndProofArr = dutiesBySubCommitteeIndex.get(subCommitteeIndex);
      if (!dutyAndProofArr) {
        dutyAndProofArr = [];
        dutiesBySubCommitteeIndex.set(subCommitteeIndex, []);
      }
      dutyAndProofArr.push(dutyAndProof);
    }
  }

  return dutiesBySubCommitteeIndex;
}
