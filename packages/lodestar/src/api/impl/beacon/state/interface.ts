import {
  BeaconState,
  BLSPubkey,
  CommitteeIndex,
  Epoch,
  FinalityCheckpoints,
  Root,
  Slot,
  ValidatorBalance,
  ValidatorIndex,
  BeaconCommitteeResponse,
} from "@chainsafe/lodestar-types";
import {ValidatorResponse} from "../../../types/validator";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";

export interface IBeaconStateApi {
  getStateRoot(stateId: StateId): Promise<Root | null>;
  getState(stateId: StateId): Promise<BeaconState | null>;
  getStateFinalityCheckpoints(stateId: StateId): Promise<FinalityCheckpoints | null>;
  getStateValidators(stateId: StateId, filters?: IValidatorFilters): Promise<ValidatorResponse[]>;
  getStateValidator(stateId: StateId, validatorId: BLSPubkey | ValidatorIndex): Promise<ValidatorResponse | null>;
  getStateValidatorBalances(stateId: StateId, indices?: (BLSPubkey | ValidatorIndex)[]): Promise<ValidatorBalance[]>;
  getStateCommittes(stateId: StateId, epoch: Epoch, filters?: ICommittesFilters): Promise<BeaconCommitteeResponse[]>;
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

export type ApiStateContext = {
  state: BeaconState;
  epochCtx?: EpochContext;
};
