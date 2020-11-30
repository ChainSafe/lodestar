import {ValidatorIndex} from "@chainsafe/lodestar-types";

export {assembleAttestationData} from "./data";

export function getAggregationBits(committee: ValidatorIndex[], validatorIndex: ValidatorIndex): boolean[] {
  return Array.from({length: committee.length}, (_, i) => committee[i] === validatorIndex);
}
