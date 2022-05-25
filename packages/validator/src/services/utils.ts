import {routes} from "@chainsafe/lodestar-api";
import {CommitteeIndex, SubcommitteeIndex} from "@chainsafe/lodestar-types";
import {AttDutyAndProof} from "./attestationDuties.js";
import {SyncDutyAndProofs, SyncSelectionProof} from "./syncCommitteeDuties.js";

/** Sync committee duty associated to a single sub committee subnet */
export type SubcommitteeDuty = {
  duty: routes.validator.SyncDuty;
  selectionProof: SyncSelectionProof["selectionProof"];
};

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

export function groupSyncDutiesBySubcommitteeIndex(
  duties: SyncDutyAndProofs[]
): Map<SubcommitteeIndex, SubcommitteeDuty[]> {
  const dutiesBySubcommitteeIndex = new Map<SubcommitteeIndex, SubcommitteeDuty[]>();

  for (const validatorDuty of duties) {
    for (const {selectionProof, subcommitteeIndex} of validatorDuty.selectionProofs) {
      let dutyAndProofArr = dutiesBySubcommitteeIndex.get(subcommitteeIndex);
      if (!dutyAndProofArr) {
        dutyAndProofArr = [];
        dutiesBySubcommitteeIndex.set(subcommitteeIndex, dutyAndProofArr);
      }
      dutyAndProofArr.push({duty: validatorDuty.duty, selectionProof: selectionProof});
    }
  }

  return dutiesBySubcommitteeIndex;
}
