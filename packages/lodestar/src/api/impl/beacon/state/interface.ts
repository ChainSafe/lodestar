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
  Fork,
} from "@chainsafe/lodestar-types";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {ValidatorResponse} from "@chainsafe/lodestar-types";

export interface IBeaconStateApi {
  getStateRoot(stateId: StateId): Promise<Root | null>;
  getState(stateId: StateId): Promise<BeaconState | null>;
  getStateFinalityCheckpoints(stateId: StateId): Promise<FinalityCheckpoints | null>;
  getStateValidators(stateId: StateId, filters?: IValidatorFilters): Promise<ValidatorResponse[]>;
  getStateValidator(stateId: StateId, validatorId: BLSPubkey | ValidatorIndex): Promise<ValidatorResponse | null>;
  getStateValidatorBalances(stateId: StateId, indices?: (BLSPubkey | ValidatorIndex)[]): Promise<ValidatorBalance[]>;
  getStateCommittees(stateId: StateId, filters?: ICommitteesFilters): Promise<BeaconCommitteeResponse[]>;
  getFork(stateId: StateId): Promise<Fork | null>;
}

export type StateId = string | "head" | "genesis" | "finalized" | "justified";

export type ValidatorStatus = "active";

export interface IValidatorFilters {
  indices?: (BLSPubkey | ValidatorIndex)[];
  statuses?: ValidatorStatus[];
}
export interface ICommitteesFilters {
  epoch?: Epoch;
  index?: CommitteeIndex;
  slot?: Slot;
}

export type ApiStateContext = {
  state: BeaconState;
  epochCtx?: EpochContext;
};
