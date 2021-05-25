import {ContainerType} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, CommitteeIndex, Slot, ValidatorIndex, Epoch, Root, Gwei} from "@chainsafe/lodestar-types";
import {mapValues} from "@chainsafe/lodestar-utils";
import {RoutesData, ReturnTypes, ArrayOf, ContainerData, RouteReqTypeGenerator, Schema, StringType} from "../../utils";

/* eslint-disable @typescript-eslint/naming-convention */

export type StateId = string | "head" | "genesis" | "finalized" | "justified";
export type ValidatorId = string | number;

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

export type ValidatorFilters = {
  indices?: ValidatorId[];
  statuses?: ValidatorStatus[];
};
export type CommitteesFilters = {
  epoch?: Epoch;
  index?: CommitteeIndex;
  slot?: Slot;
};

export interface FinalityCheckpoints {
  previousJustified: phase0.Checkpoint;
  currentJustified: phase0.Checkpoint;
  finalized: phase0.Checkpoint;
}

export interface ValidatorResponse {
  index: ValidatorIndex;
  balance: Gwei;
  status: ValidatorStatus;
  validator: phase0.Validator;
}

export interface ValidatorBalance {
  index: ValidatorIndex;
  balance: Gwei;
}

export interface EpochCommitteeResponse {
  index: CommitteeIndex;
  slot: Slot;
  validators: ValidatorIndex[];
}

export interface EpochSyncCommitteeResponse {
  /** all of the validator indices in the current sync committee */
  validators: ValidatorIndex[];
  // TODO: This property will likely be deprecated
  /** Subcommittee slices of the current sync committee */
  validatorAggregates: ValidatorIndex[];
}

export type Api = {
  /**
   * Get state SSZ HashTreeRoot
   * Calculates HashTreeRoot for state with given 'stateId'. If stateId is root, same value will be returned.
   *
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateRoot(stateId: StateId): Promise<{data: Root}>;

  /**
   * Get Fork object for requested state
   * Returns [Fork](https://github.com/ethereum/eth2.0-specs/blob/v0.11.1/specs/phase0/beacon-chain.md#fork) object for state with given 'stateId'.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateFork(stateId: StateId): Promise<{data: phase0.Fork}>;

  /**
   * Get state finality checkpoints
   * Returns finality checkpoints for state with given 'stateId'.
   * In case finality is not yet achieved, checkpoint should return epoch 0 and ZERO_HASH as root.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateFinalityCheckpoints(stateId: StateId): Promise<{data: FinalityCheckpoints}>;

  /**
   * Get validators from state
   * Returns filterable list of validators with their balance, status and index.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   * @param id Either hex encoded public key (with 0x prefix) or validator index
   * @param status [Validator status specification](https://hackmd.io/ofFJ5gOmQpu1jjHilHbdQQ)
   */
  getStateValidators(stateId: StateId, filters?: ValidatorFilters): Promise<{data: ValidatorResponse[]}>;

  /**
   * Get validator from state by id
   * Returns validator specified by state and id or public key along with status and balance.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   * @param validatorId Either hex encoded public key (with 0x prefix) or validator index
   */
  getStateValidator(stateId: StateId, validatorId: ValidatorId): Promise<{data: ValidatorResponse}>;

  /**
   * Get validator balances from state
   * Returns filterable list of validator balances.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   * @param id Either hex encoded public key (with 0x prefix) or validator index
   */
  getStateValidatorBalances(stateId: StateId, indices?: ValidatorId[]): Promise<{data: ValidatorBalance[]}>;

  /**
   * Get all committees for a state.
   * Retrieves the committees for the given state.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   * @param epoch Fetch committees for the given epoch.  If not present then the committees for the epoch of the state will be obtained.
   * @param index Restrict returned values to those matching the supplied committee index.
   * @param slot Restrict returned values to those matching the supplied slot.
   */
  getEpochCommittees(stateId: StateId, filters?: CommitteesFilters): Promise<{data: EpochCommitteeResponse[]}>;

  getEpochSyncCommittees(stateId: StateId, epoch?: Epoch): Promise<{data: EpochSyncCommitteeResponse}>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getEpochCommittees: {url: "/eth/v1/beacon/states/:stateId/committees", method: "GET"},
  getEpochSyncCommittees: {url: "/eth/v1/beacon/states/:stateId/sync_committees", method: "GET"},
  getStateFinalityCheckpoints: {url: "/eth/v1/beacon/states/:stateId/finality_checkpoints", method: "GET"},
  getStateFork: {url: "/eth/v1/beacon/states/:stateId/fork", method: "GET"},
  getStateRoot: {url: "/eth/v1/beacon/states/:stateId/root", method: "GET"},
  getStateValidator: {url: "/eth/v1/beacon/states/:stateId/validators/:validatorId", method: "GET"},
  getStateValidators: {url: "/eth/v1/beacon/states/:stateId/validator_balances", method: "GET"},
  getStateValidatorBalances: {url: "/eth/v1/beacon/states/:stateId/validators", method: "GET"},
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getReqSerializers() {
  const t = mapValues(routesData, () => (arg: unknown) => arg) as RouteReqTypeGenerator<Api>;

  const stateIdOnlyReq = t.getStateRoot<{params: {stateId: string}}>({
    writeReq: (stateId) => ({params: {stateId}}),
    parseReq: ({params}) => [params.stateId],
    schema: {params: {stateId: Schema.StringRequired}},
  });

  return {
    getEpochCommittees: t.getEpochCommittees<{
      params: {stateId: StateId};
      query: {slot?: number; epoch?: number; index?: number};
    }>({
      writeReq: (stateId, filters) => ({params: {stateId}, query: filters || {}}),
      parseReq: ({params, query}) => [params.stateId, query],
      schema: {
        params: {stateId: Schema.StringRequired},
        query: {slot: Schema.Uint, epoch: Schema.Uint, index: Schema.Uint},
      },
    }),

    getEpochSyncCommittees: t.getEpochSyncCommittees<{
      params: {stateId: StateId};
      query: {epoch?: number};
    }>({
      writeReq: (stateId, epoch) => ({params: {stateId}, query: {epoch}}),
      parseReq: ({params, query}) => [params.stateId, query.epoch],
      schema: {
        params: {stateId: Schema.StringRequired},
        query: {epoch: Schema.Uint},
      },
    }),

    getStateFinalityCheckpoints: stateIdOnlyReq,
    getStateFork: stateIdOnlyReq,
    getStateRoot: stateIdOnlyReq,

    getStateValidator: t.getStateValidator<{
      params: {stateId: StateId; validatorId: ValidatorId};
    }>({
      writeReq: (stateId, validatorId) => ({params: {stateId, validatorId}}),
      parseReq: ({params}) => [params.stateId, params.validatorId],
      schema: {
        params: {stateId: Schema.StringRequired, validatorId: Schema.StringRequired},
      },
    }),

    getStateValidators: t.getStateValidators<{
      params: {stateId: StateId};
      query: {indices?: ValidatorId[]; statuses?: ValidatorStatus[]};
    }>({
      writeReq: (stateId, filters) => ({params: {stateId}, query: filters || {}}),
      parseReq: ({params, query}) => [params.stateId, query],
      schema: {
        params: {stateId: Schema.StringRequired},
        query: {indices: Schema.UintArray, statuses: Schema.StringArray},
      },
    }),

    getStateValidatorBalances: t.getStateValidatorBalances<{
      params: {stateId: StateId};
      query: {indices?: ValidatorId[]};
    }>({
      writeReq: (stateId, indices) => ({params: {stateId}, query: {indices}}),
      parseReq: ({params, query}) => [params.stateId, query.indices],
      schema: {
        params: {stateId: Schema.StringRequired},
        query: {indices: Schema.UintArray},
      },
    }),
  };
}

export type ReqTypes = {
  [K in keyof ReturnType<typeof getReqSerializers>]: ReturnType<ReturnType<typeof getReqSerializers>[K]["writeReq"]>;
};

export function getReturnTypes(config: IBeaconConfig): ReturnTypes<Api> {
  const FinalityCheckpoints = new ContainerType<FinalityCheckpoints>({
    fields: {
      previousJustified: config.types.phase0.Checkpoint,
      currentJustified: config.types.phase0.Checkpoint,
      finalized: config.types.phase0.Checkpoint,
    },
  });

  const ValidatorResponse = new ContainerType<ValidatorResponse>({
    fields: {
      index: config.types.ValidatorIndex,
      balance: config.types.Gwei,
      status: new StringType<ValidatorStatus>(),
      validator: config.types.phase0.Validator,
    },
  });

  const ValidatorBalance = new ContainerType<ValidatorBalance>({
    fields: {
      index: config.types.ValidatorIndex,
      balance: config.types.Gwei,
    },
  });

  const EpochCommitteeResponse = new ContainerType<EpochCommitteeResponse>({
    fields: {
      index: config.types.CommitteeIndex,
      slot: config.types.Slot,
      validators: config.types.phase0.CommitteeIndices,
    },
  });

  const EpochSyncCommitteesResponse = new ContainerType<EpochSyncCommitteeResponse>({
    fields: {
      validators: ArrayOf(config.types.ValidatorIndex),
      validatorAggregates: ArrayOf(config.types.ValidatorIndex),
    },
  });

  return {
    getStateRoot: ContainerData(config.types.Root),
    getStateFork: ContainerData(config.types.phase0.Fork),
    getStateFinalityCheckpoints: ContainerData(FinalityCheckpoints),
    getStateValidators: ContainerData(ArrayOf(ValidatorResponse)),
    getStateValidator: ContainerData(ValidatorResponse),
    getStateValidatorBalances: ContainerData(ArrayOf(ValidatorBalance)),
    getEpochCommittees: ContainerData(ArrayOf(EpochCommitteeResponse)),
    getEpochSyncCommittees: ContainerData(EpochSyncCommitteesResponse),
  };
}
