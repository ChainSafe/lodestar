import {BLSPubkey, CommitteeIndex, Epoch, Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";

export interface IBeaconStateApi {
  getStateRoot(stateId: StateId): Promise<Root | null>;
  getState(stateId: StateId): Promise<phase0.BeaconState | null>;
  getStateFinalityCheckpoints(stateId: StateId): Promise<phase0.FinalityCheckpoints | null>;
  getStateValidators(stateId: StateId, filters?: IValidatorFilters): Promise<phase0.ValidatorResponse[]>;
  getStateValidator(
    stateId: StateId,
    validatorId: BLSPubkey | ValidatorIndex
  ): Promise<phase0.ValidatorResponse | null>;
  getStateValidatorBalances(
    stateId: StateId,
    indices?: (BLSPubkey | ValidatorIndex)[]
  ): Promise<phase0.ValidatorBalance[]>;
  getStateCommittees(stateId: StateId, filters?: ICommitteesFilters): Promise<phase0.BeaconCommitteeResponse[]>;
  getFork(stateId: StateId): Promise<phase0.Fork | null>;
}

export type StateId = string | "head" | "genesis" | "finalized" | "justified";

export type ValidatorStatus =
  | "active"
  | "pending_initialized"
  | "pending_queued"
  | "active_ongoing"
  | "active_exiting"
  | "active_slashed"
  | "exited_unslashed"
  | "exited_slashed"
  | "withdrawal_possible"
  | "withdrawal_done";

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
  state: phase0.BeaconState;
  epochCtx?: phase0.fast.EpochContext;
};
