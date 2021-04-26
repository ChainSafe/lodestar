import {allForks} from "@chainsafe/lodestar-types";
import {ValidatorIndex} from "@chainsafe/lodestar-types/phase0";
import {ByteVector} from "@chainsafe/ssz";
import {IBeaconChain} from "../../chain/interface";

export function getStateValidatorIndex(
  id: number | ByteVector,
  state: allForks.BeaconState,
  chain: IBeaconChain
): number | undefined {
  let validatorIndex: ValidatorIndex | undefined;
  if (typeof id === "number") {
    if (state.validators.length > id) {
      validatorIndex = id;
    }
  } else {
    validatorIndex = chain.getHeadState().pubkey2index.get(id) ?? undefined;
    // validator added later than given stateId
    if (validatorIndex && validatorIndex >= state.validators.length) {
      validatorIndex = undefined;
    }
  }
  return validatorIndex;
}
