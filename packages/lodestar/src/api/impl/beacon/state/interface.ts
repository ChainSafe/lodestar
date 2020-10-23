import {
  BeaconState,
  Root,
  BLSPubkey,
  ValidatorIndex,
  CommitteeIndex,
  Slot,
  Epoch,
  FinalityCheckpoints,
  ValidatorBalance,
} from "@chainsafe/lodestar-types";
import {ValidatorResponse} from "../../../types/validator";
import {EpochContext} from "../../../../../../lodestar-beacon-state-transition/src/fast/util/epochContext";

export interface IBeaconStateApi {
  getStateRoot(stateId: StateId): Promise<Root | null>;
  getState<T extends boolean>(stateId: StateId, withEpochContext?: T): Promise<ApiStateContext<T> | null>;
  getStateFinalityCheckpoints(stateId: StateId): Promise<FinalityCheckpoints | null>;
  getStateValidators(stateId: StateId, filters?: IValidatorFilters): Promise<ValidatorResponse[]>;
  getStateValidator(stateId: StateId, validatorId: BLSPubkey | ValidatorIndex): Promise<ValidatorResponse | null>;
  getStateValidatorBalances(stateId: StateId, indices?: (BLSPubkey | ValidatorIndex)[]): Promise<ValidatorBalance[]>;
  getStateCommittes(stateId: StateId, epoch: Epoch, filters?: ICommittesFilters): Promise<ValidatorBalance[]>;
}

export type StateId = string | "head" | "genesis" | "finalized" | "justified";

export type ValidatorStatus = "active";

export interface IValidatorFilters {
  indices?: (BLSPubkey | ValidatorIndex)[];
  statuses?: ValidatorStatus[];
}
export interface ICommittesFilters {
  index?: CommitteeIndex;
  slot?: Slot;
}

export type ApiStateContext<T extends true | false = true> = {
  state: BeaconState;
  epochCtx: T extends true ? EpochContext : undefined;
};
