import {Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {SeenAttesters} from "./seenAttesters.js";
// TODO abstract out the Seen* caches into an abstract abstract data structure
// that all the caches can extend since they share similar structure.

export class SeenBlockAttesters extends SeenAttesters {
  addIndices(epoch: Epoch, validatorIndexes: ValidatorIndex[]): void {
    if (epoch < this.lowestPermissibleEpoch) {
      throw Error(`EpochTooLow ${epoch} < ${this.lowestPermissibleEpoch}`);
    }

    const indexesByEpoch = this.validatorIndexesByEpoch.getOrDefault(epoch);

    for (const index of validatorIndexes) {
      indexesByEpoch.add(index);
    }
  }
}
