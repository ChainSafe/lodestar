/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {phase0, CommitteeIndex, Slot, Epoch, ssz, RootHex, StringType} from "@lodestar/types";
import {Endpoint, RequestCodec, RouteDefinitions, Schema} from "../../../utils/index.js";
import {ArrayOf, ExecutionOptimisticCodec, ExecutionOptimisticMeta} from "../../../utils/codecs.js";
import {RootResponse, RootResponseType} from "./block.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type StateId = RootHex | Slot | "head" | "genesis" | "finalized" | "justified";
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

export const RandaoResponseType = new ContainerType({
  randao: ssz.Root,
});
export const FinalityCheckpointsType = new ContainerType({
  previousJustified: ssz.phase0.Checkpoint,
  currentJustified: ssz.phase0.Checkpoint,
  finalized: ssz.phase0.Checkpoint,
});
export const ValidatorResponseType = new ContainerType({
  index: ssz.ValidatorIndex,
  balance: ssz.UintNum64,
  status: new StringType<ValidatorStatus>(),
  validator: ssz.phase0.Validator,
});
export const EpochCommitteeResponseType = new ContainerType({
  index: ssz.CommitteeIndex,
  slot: ssz.Slot,
  validators: ArrayOf(ssz.ValidatorIndex),
});
export const ValidatorBalanceType = new ContainerType({
  index: ssz.ValidatorIndex,
  balance: ssz.UintNum64,
});
export const EpochSyncCommitteeResponseType = new ContainerType({
  /** all of the validator indices in the current sync committee */
  validators: ArrayOf(ssz.ValidatorIndex),
  // TODO: This property will likely be deprecated
  /** Subcommittee slices of the current sync committee */
  validatorAggregates: ArrayOf(ArrayOf(ssz.ValidatorIndex)),
});
export const ValidatorResponseListType = ArrayOf(ValidatorResponseType);
export const EpochCommitteeResponseListType = ArrayOf(EpochCommitteeResponseType);
export const ValidatorBalanceListType = ArrayOf(ValidatorBalanceType);

export type RandaoResponse = ValueOf<typeof RandaoResponseType>;
export type FinalityCheckpoints = ValueOf<typeof FinalityCheckpointsType>;
export type ValidatorResponse = ValueOf<typeof ValidatorResponseType>;
export type EpochCommitteeResponse = ValueOf<typeof EpochCommitteeResponseType>;
export type ValidatorBalance = ValueOf<typeof ValidatorBalanceType>;
export type EpochSyncCommitteeResponse = ValueOf<typeof EpochSyncCommitteeResponseType>;

export type ValidatorResponseList = ValueOf<typeof ValidatorResponseListType>;
export type EpochCommitteeResponseList = ValueOf<typeof EpochCommitteeResponseListType>;
export type ValidatorBalanceList = ValueOf<typeof ValidatorBalanceListType>;

export type Endpoints = {
  /**
   * Get state SSZ HashTreeRoot
   * Calculates HashTreeRoot for state with given 'stateId'. If stateId is root, same value will be returned.
   *
   * param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateRoot: Endpoint<
    //
    "GET",
    {stateId: StateId},
    {params: {state_id: string}},
    RootResponse,
    ExecutionOptimisticMeta
  >;

  /**
   * Get Fork object for requested state
   * Returns [Fork](https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/beacon-chain.md#fork) object for state with given 'stateId'.
   *
   * param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateFork: Endpoint<
    //
    "GET",
    {stateId: StateId},
    {params: {state_id: string}},
    phase0.Fork,
    ExecutionOptimisticMeta
  >;

  /**
   * Fetch the RANDAO mix for the requested epoch from the state identified by 'stateId'.
   *
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   * @param epoch Fetch randao mix for the given epoch. If an epoch is not specified then the RANDAO mix for the state's current epoch will be returned.
   */
  getStateRandao: Endpoint<
    "GET",
    {stateId: StateId; epoch?: Epoch},
    {params: {state_id: string}; query: {epoch?: number}},
    RandaoResponse,
    ExecutionOptimisticMeta
  >;

  /**
   * Get state finality checkpoints
   * Returns finality checkpoints for state with given 'stateId'.
   * In case finality is not yet achieved, checkpoint should return epoch 0 and ZERO_HASH as root.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  getStateFinalityCheckpoints: Endpoint<
    //
    "GET",
    {stateId: StateId},
    {params: {state_id: string}},
    FinalityCheckpoints,
    ExecutionOptimisticMeta
  >;

  /**
   * Get validator from state by id
   * Returns validator specified by state and id or public key along with status and balance.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   * @param validatorId Either hex encoded public key (with 0x prefix) or validator index
   */
  getStateValidator: Endpoint<
    //
    "GET",
    {stateId: StateId; validatorId: ValidatorId},
    {params: {state_id: string; validator_id: ValidatorId}},
    ValidatorResponse,
    ExecutionOptimisticMeta
  >;

  /**
   * Get validators from state
   * Returns filterable list of validators with their balance, status and index.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   * @param id Either hex encoded public key (with 0x prefix) or validator index
   * @param status [Validator status specification](https://hackmd.io/ofFJ5gOmQpu1jjHilHbdQQ)
   */
  getStateValidators: Endpoint<
    //
    "GET",
    {stateId: StateId; id?: ValidatorId[]; status?: ValidatorStatus[]},
    {params: {state_id: string}; query: {id?: ValidatorId[]; status?: ValidatorStatus[]}},
    ValidatorResponseList,
    ExecutionOptimisticMeta
  >;

  /**
   * Get validator balances from state
   * Returns filterable list of validator balances.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   * @param id Either hex encoded public key (with 0x prefix) or validator index
   */
  getStateValidatorBalances: Endpoint<
    //
    "GET",
    {stateId: StateId; indices?: ValidatorId[]},
    {params: {state_id: string}; query: {id?: ValidatorId[]}},
    ValidatorBalanceList,
    ExecutionOptimisticMeta
  >;

  /**
   * Get all committees for a state.
   * Retrieves the committees for the given state.
   * @param stateId State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   * @param epoch Fetch committees for the given epoch.  If not present then the committees for the epoch of the state will be obtained.
   * @param index Restrict returned values to those matching the supplied committee index.
   * @param slot Restrict returned values to those matching the supplied slot.
   */
  getEpochCommittees: Endpoint<
    //
    "GET",
    {stateId: StateId; epoch?: Epoch; index?: CommitteeIndex; slot?: Slot},
    {params: {state_id: string}; query: {slot?: number; epoch?: number; index?: number}},
    EpochCommitteeResponseList,
    ExecutionOptimisticMeta
  >;

  getEpochSyncCommittees: Endpoint<
    //
    "GET",
    {stateId: StateId; epoch?: Epoch},
    {params: {state_id: string}; query: {epoch?: number}},
    EpochSyncCommitteeResponse,
    ExecutionOptimisticMeta
  >;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stateIdOnlyReq: RequestCodec<Endpoint<"GET", {stateId: StateId}, {params: {state_id: string}}, any, any>> = {
  writeReq: (state_id) => ({params: {state_id: String(state_id)}}),
  parseReq: ({params}) => ({stateId: params.state_id}),
  schema: {params: {state_id: Schema.StringRequired}},
};

export const definitions: RouteDefinitions<Endpoints> = {
  getEpochCommittees: {
    url: "/eth/v1/beacon/states/{state_id}/committees",
    method: "GET",
    req: {
      writeReq: ({stateId, epoch, index, slot}) => ({params: {state_id: String(stateId)}, query: {epoch, index, slot}}),
      parseReq: ({params, query}) => ({
        stateId: params.state_id,
        epoch: query.epoch,
        index: query.index,
        slot: query.slot,
      }),
      schema: {
        params: {state_id: Schema.StringRequired},
        query: {slot: Schema.Uint, epoch: Schema.Uint, index: Schema.Uint},
      },
    },
    resp: {
      data: EpochCommitteeResponseListType,
      meta: ExecutionOptimisticCodec,
    },
  },
  getEpochSyncCommittees: {
    url: "/eth/v1/beacon/states/{state_id}/sync_committees",
    method: "GET",
    req: {
      writeReq: ({stateId, epoch}) => ({params: {state_id: String(stateId)}, query: {epoch}}),
      parseReq: ({params, query}) => ({stateId: params.state_id, epoch: query.epoch}),
      schema: {
        params: {state_id: Schema.StringRequired},
        query: {epoch: Schema.Uint},
      },
    },
    resp: {
      data: EpochSyncCommitteeResponseType,
      meta: ExecutionOptimisticCodec,
    },
  },
  getStateFinalityCheckpoints: {
    url: "/eth/v1/beacon/states/{state_id}/finality_checkpoints",
    method: "GET",
    req: stateIdOnlyReq,
    resp: {
      data: FinalityCheckpointsType,
      meta: ExecutionOptimisticCodec,
    },
  },
  getStateFork: {
    url: "/eth/v1/beacon/states/{state_id}/fork",
    method: "GET",
    req: stateIdOnlyReq,
    resp: {
      data: ssz.phase0.Fork,
      meta: ExecutionOptimisticCodec,
    },
  },
  getStateRoot: {
    url: "/eth/v1/beacon/states/{state_id}/root",
    method: "GET",
    req: stateIdOnlyReq,
    resp: {
      data: RootResponseType,
      meta: ExecutionOptimisticCodec,
    },
  },
  getStateRandao: {
    url: "/eth/v1/beacon/states/{state_id}/randao",
    method: "GET",
    req: {
      writeReq: ({stateId, epoch}) => ({params: {state_id: String(stateId)}, query: {epoch}}),
      parseReq: ({params, query}) => ({stateId: params.state_id, epoch: query.epoch}),
      schema: {
        params: {state_id: Schema.StringRequired},
        query: {epoch: Schema.Uint},
      },
    },
    resp: {
      data: RandaoResponseType,
      meta: ExecutionOptimisticCodec,
    },
  },
  getStateValidator: {
    url: "/eth/v1/beacon/states/{state_id}/validators/{validator_id}",
    method: "GET",
    req: {
      writeReq: ({stateId, validatorId}) => ({params: {state_id: String(stateId), validator_id: validatorId}}),
      parseReq: ({params}) => ({stateId: params.state_id, validatorId: params.validator_id}),
      schema: {
        params: {state_id: Schema.StringRequired, validator_id: Schema.StringRequired},
      },
    },
    resp: {
      data: ValidatorResponseType,
      meta: ExecutionOptimisticCodec,
    },
  },
  getStateValidators: {
    url: "/eth/v1/beacon/states/{state_id}/validators",
    method: "GET",
    req: {
      writeReq: ({stateId, id, status}) => ({params: {state_id: String(stateId)}, query: {id, status}}),
      parseReq: ({params, query}) => ({stateId: params.state_id, id: query.id, status: query.status}),
      schema: {
        params: {state_id: Schema.StringRequired},
        query: {id: Schema.UintOrStringArray, status: Schema.StringArray},
      },
    },
    resp: {
      data: ValidatorResponseListType,
      meta: ExecutionOptimisticCodec,
    },
  },
  getStateValidatorBalances: {
    url: "/eth/v1/beacon/states/{state_id}/validator_balances",
    method: "GET",
    req: {
      writeReq: ({stateId, indices}) => ({params: {state_id: String(stateId)}, query: {id: indices}}),
      parseReq: ({params, query}) => ({stateId: params.state_id, indices: query.id}),
      schema: {
        params: {state_id: Schema.StringRequired},
        query: {id: Schema.UintOrStringArray},
      },
    },
    resp: {
      data: ValidatorBalanceListType,
      meta: ExecutionOptimisticCodec,
    },
  },
};
