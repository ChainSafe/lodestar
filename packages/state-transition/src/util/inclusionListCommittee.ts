import {ValidatorIndex} from "@lodestar/types";

/** Spec `InclusionListCommittee` of one slot */
export class InclusionListCommittee {
  constructor(readonly validatorIndices: Uint32Array) {}

  /** Positions of `validatorIndex`, several when the committee cycles over a slot with fewer validators than its size */
  getCommitteeIndices(validatorIndex: ValidatorIndex): number[] {
    const committeeIndices: number[] = [];
    for (let i = 0; i < this.validatorIndices.length; i++) {
      if (this.validatorIndices[i] === validatorIndex) {
        committeeIndices.push(i);
      }
    }
    return committeeIndices;
  }
}
