import {routes} from "@chainsafe/lodestar-api";
import {CommitteeIndex, SubCommitteeIndex} from "@chainsafe/lodestar-types";
import {AttDutyAndProof} from "./attestationDuties";
import {SyncDutyAndProofs, SyncSelectionProof} from "./syncCommitteeDuties";

/** Sync committee duty associated to a single sub committee subnet */
export type SubCommitteeDuty = {
  duty: routes.validator.SyncDuty;
  selectionProof: SyncSelectionProof["selectionProof"];
};

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
  duties: SyncDutyAndProofs[]
): Map<SubCommitteeIndex, SubCommitteeDuty[]> {
  const dutiesBySubCommitteeIndex = new Map<SubCommitteeIndex, SubCommitteeDuty[]>();

  for (const validatorDuty of duties) {
    for (const {selectionProof, subCommitteeIndex} of validatorDuty.selectionProofs) {
      let dutyAndProofArr = dutiesBySubCommitteeIndex.get(subCommitteeIndex);
      if (!dutyAndProofArr) {
        dutyAndProofArr = [];
        dutiesBySubCommitteeIndex.set(subCommitteeIndex, dutyAndProofArr);
      }
      dutyAndProofArr.push({duty: validatorDuty.duty, selectionProof: selectionProof});
    }
  }

  return dutiesBySubCommitteeIndex;
}
