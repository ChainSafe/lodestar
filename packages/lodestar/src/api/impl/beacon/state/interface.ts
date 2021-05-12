import {
  phase0,
  allForks,
  altair,
  BLSPubkey,
  CommitteeIndex,
  Epoch,
  Root,
  Slot,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";

export interface IBeaconStateApi {
  getStateRoot(stateId: StateId): Promise<Root>;
  getState(stateId: StateId): Promise<allForks.BeaconState>;
  getStateFinalityCheckpoints(stateId: StateId): Promise<phase0.FinalityCheckpoints>;
  getStateValidators(stateId: StateId, filters?: IValidatorFilters): Promise<phase0.ValidatorResponse[]>;
  getStateValidator(stateId: StateId, validatorId: BLSPubkey | ValidatorIndex): Promise<phase0.ValidatorResponse>;
  getStateValidatorBalances(
    stateId: StateId,
    indices?: (BLSPubkey | ValidatorIndex)[]
  ): Promise<phase0.ValidatorBalance[]>;
  getStateCommittees(stateId: StateId, filters?: ICommitteesFilters): Promise<phase0.BeaconCommitteeResponse[]>;
  getEpochSyncCommittees(stateId: StateId, epoch?: Epoch): Promise<altair.SyncCommittee[]>;
  getFork(stateId: StateId): Promise<phase0.Fork>;
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
