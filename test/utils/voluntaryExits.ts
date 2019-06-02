import {VoluntaryExit} from "../../src/types";

export function generateEmptyVoluntaryExit(): VoluntaryExit {
  return {
    epoch: 0,
    validatorIndex: 0,
    signature: Buffer.alloc(96)
  };
}


export function voluntaryExitsFromYaml(value: any): VoluntaryExit {
  return {
    epoch: undefined, signature: undefined, validatorIndex: undefined
  };
}
