import {ContainerType} from "@chainsafe/ssz";
import {phase0, CommitteeIndex, Slot, ValidatorIndex, Epoch, Root, ssz, StringType, RootHex} from "@lodestar/types";
import {
  RoutesData,
  ReturnTypes,
  ArrayOf,
  ContainerDataExecutionOptimistic,
  Schema,
  ReqSerializers,
  ReqSerializer,
} from "../../../utils/index.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type StateId = RootHex | Slot | "head" | "genesis" | "finalized" | "justified";
export type ValidatorId = string | number;

/**
 * True if the response references an unverified execution payload. Optimistic information may be invalidated at
 * a later time. If the field is not present, assume the False value.
 */
export type ExecutionOptimistic = boolean;

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
  id?: ValidatorId[];
  status?: ValidatorStatus[];
};
export type CommitteesFilters = {
  epoch?: Epoch;
  index?: CommitteeIndex;
  slot?: Slot;
};

export type FinalityCheckpoints = {
  previousJustified: phase0.Checkpoint;
  currentJustified: phase0.Checkpoint;
  finalized: phase0.Checkpoint;
};

export type ValidatorResponse = {
  index: ValidatorIndex;
  balance: number;
  status: ValidatorStatus;
  validator: phase0.Validator;
};

export type ValidatorBalance = {
  index: ValidatorIndex;
  balance: number;
};

export type EpochCommitteeResponse = {
  index: CommitteeIndex;
  slot: Slot;
  validators: ValidatorIndex[];
};

export type EpochSyncCommitteeResponse = {
  /** all of the validator indices in the current sync committee */
  validators: ValidatorIndex[];
  // TODO: This property will likely be deprecated
  /** Subcommittee slices of the current sync committee */
  validatorAggregates: ValidatorIndex[][];
};

export type Api = {
  /**
   * Get state SSZ HashTreeRoot
   * Calculates HashTreeRoot for state with given 'stateId'. If stateId is root, same value will be returned.
   *
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateRoot(stateId: StateId): Promise<{executionOptimistic: ExecutionOptimistic; data: {root: Root}}>;

  /**
   * Get Fork object for requested state
   * Returns [Fork](https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/beacon-chain.md#fork) object for state with given 'stateId'.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateFork(stateId: StateId): Promise<{executionOptimistic: ExecutionOptimistic; data: phase0.Fork}>;

  /**
   * Get state finality checkpoints
   * Returns finality checkpoints for state with given 'stateId'.
   * In case finality is not yet achieved, checkpoint should return epoch 0 and ZERO_HASH as root.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateFinalityCheckpoints(
    stateId: StateId
  ): Promise<{executionOptimistic: ExecutionOptimistic; data: FinalityCheckpoints}>;

  /**
   * Get validators from state
   * Returns filterable list of validators with their balance, status and index.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   * @param id Either hex encoded public key (with 0x prefix) or validator index
   * @param status [Validator status specification](https://hackmd.io/ofFJ5gOmQpu1jjHilHbdQQ)
   */
  getStateValidators(
    stateId: StateId,
    filters?: ValidatorFilters
  ): Promise<{executionOptimistic: ExecutionOptimistic; data: ValidatorResponse[]}>;

  /**
   * Get validator from state by id
   * Returns validator specified by state and id or public key along with status and balance.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   * @param validatorId Either hex encoded public key (with 0x prefix) or validator index
   */
  getStateValidator(
    stateId: StateId,
    validatorId: ValidatorId
  ): Promise<{executionOptimistic: ExecutionOptimistic; data: ValidatorResponse}>;

  /**
   * Get validator balances from state
   * Returns filterable list of validator balances.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   * @param id Either hex encoded public key (with 0x prefix) or validator index
   */
  getStateValidatorBalances(
    stateId: StateId,
    indices?: ValidatorId[]
  ): Promise<{executionOptimistic: ExecutionOptimistic; data: ValidatorBalance[]}>;

  /**
   * Get all committees for a state.
   * Retrieves the committees for the given state.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   * @param epoch Fetch committees for the given epoch.  If not present then the committees for the epoch of the state will be obtained.
   * @param index Restrict returned values to those matching the supplied committee index.
   * @param slot Restrict returned values to those matching the supplied slot.
   */
  getEpochCommittees(
    stateId: StateId,
    filters?: CommitteesFilters
  ): Promise<{executionOptimistic: ExecutionOptimistic; data: EpochCommitteeResponse[]}>;

  getEpochSyncCommittees(
    stateId: StateId,
    epoch?: Epoch
  ): Promise<{executionOptimistic: ExecutionOptimistic; data: EpochSyncCommitteeResponse}>;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getEpochCommittees: {url: "/eth/v1/beacon/states/{state_id}/committees", method: "GET"},
  getEpochSyncCommittees: {url: "/eth/v1/beacon/states/{state_id}/sync_committees", method: "GET"},
  getStateFinalityCheckpoints: {url: "/eth/v1/beacon/states/{state_id}/finality_checkpoints", method: "GET"},
  getStateFork: {url: "/eth/v1/beacon/states/{state_id}/fork", method: "GET"},
  getStateRoot: {url: "/eth/v1/beacon/states/{state_id}/root", method: "GET"},
  getStateValidator: {url: "/eth/v1/beacon/states/{state_id}/validators/{validator_id}", method: "GET"},
  getStateValidators: {url: "/eth/v1/beacon/states/{state_id}/validators", method: "GET"},
  getStateValidatorBalances: {url: "/eth/v1/beacon/states/{state_id}/validator_balances", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */

type StateIdOnlyReq = {params: {state_id: string}};

export type ReqTypes = {
  getEpochCommittees: {params: {state_id: StateId}; query: {slot?: number; epoch?: number; index?: number}};
  getEpochSyncCommittees: {params: {state_id: StateId}; query: {epoch?: number}};
  getStateFinalityCheckpoints: StateIdOnlyReq;
  getStateFork: StateIdOnlyReq;
  getStateRoot: StateIdOnlyReq;
  getStateValidator: {params: {state_id: StateId; validator_id: ValidatorId}};
  getStateValidators: {params: {state_id: StateId}; query: {id?: ValidatorId[]; status?: ValidatorStatus[]}};
  getStateValidatorBalances: {params: {state_id: StateId}; query: {id?: ValidatorId[]}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  const stateIdOnlyReq: ReqSerializer<Api["getStateFork"], StateIdOnlyReq> = {
    writeReq: (state_id) => ({params: {state_id: String(state_id)}}),
    parseReq: ({params}) => [params.state_id],
    schema: {params: {state_id: Schema.StringRequired}},
  };

  return {
    getEpochCommittees: {
      writeReq: (state_id, filters) => ({params: {state_id}, query: filters || {}}),
      parseReq: ({params, query}) => [params.state_id, query],
      schema: {
        params: {state_id: Schema.StringRequired},
        query: {slot: Schema.Uint, epoch: Schema.Uint, index: Schema.Uint},
      },
    },

    getEpochSyncCommittees: {
      writeReq: (state_id, epoch) => ({params: {state_id}, query: {epoch}}),
      parseReq: ({params, query}) => [params.state_id, query.epoch],
      schema: {
        params: {state_id: Schema.StringRequired},
        query: {epoch: Schema.Uint},
      },
    },

    getStateFinalityCheckpoints: stateIdOnlyReq,
    getStateFork: stateIdOnlyReq,
    getStateRoot: stateIdOnlyReq,

    getStateValidator: {
      writeReq: (state_id, validator_id) => ({params: {state_id, validator_id}}),
      parseReq: ({params}) => [params.state_id, params.validator_id],
      schema: {
        params: {state_id: Schema.StringRequired, validator_id: Schema.StringRequired},
      },
    },

    getStateValidators: {
      writeReq: (state_id, filters) => ({params: {state_id}, query: filters || {}}),
      parseReq: ({params, query}) => [params.state_id, query],
      schema: {
        params: {state_id: Schema.StringRequired},
        query: {id: Schema.UintOrStringArray, status: Schema.StringArray},
      },
    },

    getStateValidatorBalances: {
      writeReq: (state_id, id) => ({params: {state_id}, query: {id}}),
      parseReq: ({params, query}) => [params.state_id, query.id],
      schema: {
        params: {state_id: Schema.StringRequired},
        query: {id: Schema.UintOrStringArray},
      },
    },
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  const RootContainer = new ContainerType({
    root: ssz.Root,
  });

  const FinalityCheckpoints = new ContainerType(
    {
      previousJustified: ssz.phase0.Checkpoint,
      currentJustified: ssz.phase0.Checkpoint,
      finalized: ssz.phase0.Checkpoint,
    },
    {jsonCase: "eth2"}
  );

  const ValidatorResponse = new ContainerType(
    {
      index: ssz.ValidatorIndex,
      balance: ssz.UintNum64,
      status: new StringType<ValidatorStatus>(),
      validator: ssz.phase0.Validator,
    },
    {jsonCase: "eth2"}
  );

  const ValidatorBalance = new ContainerType(
    {
      index: ssz.ValidatorIndex,
      balance: ssz.UintNum64,
    },
    {jsonCase: "eth2"}
  );

  const EpochCommitteeResponse = new ContainerType(
    {
      index: ssz.CommitteeIndex,
      slot: ssz.Slot,
      validators: ssz.phase0.CommitteeIndices,
    },
    {jsonCase: "eth2"}
  );

  const EpochSyncCommitteesResponse = new ContainerType(
    {
      validators: ArrayOf(ssz.ValidatorIndex),
      validatorAggregates: ArrayOf(ArrayOf(ssz.ValidatorIndex)),
    },
    {jsonCase: "eth2"}
  );

  return {
    getStateRoot: ContainerDataExecutionOptimistic(RootContainer),
    getStateFork: ContainerDataExecutionOptimistic(ssz.phase0.Fork),
    getStateFinalityCheckpoints: ContainerDataExecutionOptimistic(FinalityCheckpoints),
    getStateValidators: ContainerDataExecutionOptimistic(ArrayOf(ValidatorResponse)),
    getStateValidator: ContainerDataExecutionOptimistic(ValidatorResponse),
    getStateValidatorBalances: ContainerDataExecutionOptimistic(ArrayOf(ValidatorBalance)),
    getEpochCommittees: ContainerDataExecutionOptimistic(ArrayOf(EpochCommitteeResponse)),
    getEpochSyncCommittees: ContainerDataExecutionOptimistic(EpochSyncCommitteesResponse),
  };
}
