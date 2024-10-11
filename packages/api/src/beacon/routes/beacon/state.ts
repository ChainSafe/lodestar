import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {MAX_VALIDATORS_PER_COMMITTEE} from "@lodestar/params";
import {phase0, CommitteeIndex, Slot, Epoch, ssz, RootHex, StringType, ValidatorStatus} from "@lodestar/types";
import {Endpoint, RequestCodec, RouteDefinitions, Schema} from "../../../utils/index.js";
import {ArrayOf, JsonOnlyReq} from "../../../utils/codecs.js";
import {ExecutionOptimisticAndFinalizedCodec, ExecutionOptimisticAndFinalizedMeta} from "../../../utils/metadata.js";
import {fromValidatorIdsStr, toValidatorIdsStr} from "../../../utils/serdes.js";
import {WireFormat} from "../../../utils/wireFormat.js";
import {RootResponse, RootResponseType} from "./block.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type StateId = RootHex | Slot | "head" | "genesis" | "finalized" | "justified";

export type StateArgs = {
  /**
   * State identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", "justified", \<slot\>, \<hex encoded stateRoot with 0x prefix\>.
   */
  stateId: StateId;
};

export type ValidatorId = string | number;

export type {ValidatorStatus};

export const RandaoResponseType = new ContainerType({
  randao: ssz.Root,
});
export const FinalityCheckpointsType = new ContainerType(
  {
    previousJustified: ssz.phase0.Checkpoint,
    currentJustified: ssz.phase0.Checkpoint,
    finalized: ssz.phase0.Checkpoint,
  },
  {jsonCase: "eth2"}
);
export const ValidatorResponseType = new ContainerType({
  index: ssz.ValidatorIndex,
  balance: ssz.UintNum64,
  status: new StringType<ValidatorStatus>(),
  validator: ssz.phase0.Validator,
});
export const ValidatorIdentityType = new ContainerType(
  {
    index: ssz.ValidatorIndex,
    pubkey: ssz.BLSPubkey,
    activationEpoch: ssz.UintNum64,
  },
  {jsonCase: "eth2"}
);
export const EpochCommitteeResponseType = new ContainerType({
  index: ssz.CommitteeIndex,
  slot: ssz.Slot,
  validators: ArrayOf(ssz.ValidatorIndex, MAX_VALIDATORS_PER_COMMITTEE),
});
export const ValidatorBalanceType = new ContainerType({
  index: ssz.ValidatorIndex,
  balance: ssz.UintNum64,
});
export const EpochSyncCommitteeResponseType = new ContainerType(
  {
    /** All of the validator indices in the current sync committee */
    validators: ArrayOf(ssz.ValidatorIndex),
    // TODO: This property will likely be deprecated
    /** Subcommittee slices of the current sync committee */
    validatorAggregates: ArrayOf(ArrayOf(ssz.ValidatorIndex)),
  },
  {jsonCase: "eth2"}
);
export const ValidatorResponseListType = ArrayOf(ValidatorResponseType);
export const ValidatorIdentitiesType = ArrayOf(ValidatorIdentityType);
export const EpochCommitteeResponseListType = ArrayOf(EpochCommitteeResponseType);
export const ValidatorBalanceListType = ArrayOf(ValidatorBalanceType);

export type RandaoResponse = ValueOf<typeof RandaoResponseType>;
export type FinalityCheckpoints = ValueOf<typeof FinalityCheckpointsType>;
export type ValidatorResponse = ValueOf<typeof ValidatorResponseType>;
export type EpochCommitteeResponse = ValueOf<typeof EpochCommitteeResponseType>;
export type ValidatorBalance = ValueOf<typeof ValidatorBalanceType>;
export type EpochSyncCommitteeResponse = ValueOf<typeof EpochSyncCommitteeResponseType>;

export type ValidatorResponseList = ValueOf<typeof ValidatorResponseListType>;
export type ValidatorIdentities = ValueOf<typeof ValidatorIdentitiesType>;
export type EpochCommitteeResponseList = ValueOf<typeof EpochCommitteeResponseListType>;
export type ValidatorBalanceList = ValueOf<typeof ValidatorBalanceListType>;

export type Endpoints = {
  /**
   * Get state SSZ HashTreeRoot
   * Calculates HashTreeRoot for state with given 'stateId'. If stateId is root, same value will be returned.
   */
  getStateRoot: Endpoint<
    "GET",
    StateArgs,
    {params: {state_id: string}},
    RootResponse,
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get Fork object for requested state
   * Returns [Fork](https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/beacon-chain.md#fork) object for state with given 'stateId'.
   */
  getStateFork: Endpoint<
    "GET",
    StateArgs,
    {params: {state_id: string}},
    phase0.Fork,
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Fetch the RANDAO mix for the requested epoch from the state identified by 'stateId'.
   */
  getStateRandao: Endpoint<
    "GET",
    StateArgs & {
      /**
       * Fetch randao mix for the given epoch. If an epoch is not specified
       * then the RANDAO mix for the state's current epoch will be returned.
       */
      epoch?: Epoch;
    },
    {params: {state_id: string}; query: {epoch?: number}},
    RandaoResponse,
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get state finality checkpoints
   * Returns finality checkpoints for state with given 'stateId'.
   * In case finality is not yet achieved, checkpoint should return epoch 0 and ZERO_HASH as root.
   */
  getStateFinalityCheckpoints: Endpoint<
    "GET",
    StateArgs,
    {params: {state_id: string}},
    FinalityCheckpoints,
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get validator from state by id
   * Returns validator specified by state and id or public key along with status and balance.
   */
  getStateValidator: Endpoint<
    "GET",
    StateArgs & {
      /** Either hex encoded public key (with 0x prefix) or validator index */
      validatorId: ValidatorId;
    },
    {params: {state_id: string; validator_id: ValidatorId}},
    ValidatorResponse,
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get validators from state
   * Returns filterable list of validators with their balance, status and index.
   */
  getStateValidators: Endpoint<
    "GET",
    StateArgs & {
      /** Either hex encoded public key (with 0x prefix) or validator index */
      validatorIds?: ValidatorId[];
      /** [Validator status specification](https://hackmd.io/ofFJ5gOmQpu1jjHilHbdQQ) */
      statuses?: ValidatorStatus[];
    },
    {params: {state_id: string}; query: {id?: ValidatorId[]; status?: ValidatorStatus[]}},
    ValidatorResponseList,
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get validators from state
   * Returns filterable list of validators with their balance, status and index.
   */
  postStateValidators: Endpoint<
    "POST",
    StateArgs & {
      /** Either hex encoded public key (with 0x prefix) or validator index */
      validatorIds?: ValidatorId[];
      /** [Validator status specification](https://hackmd.io/ofFJ5gOmQpu1jjHilHbdQQ) */
      statuses?: ValidatorStatus[];
    },
    {params: {state_id: string}; body: {ids?: string[]; statuses?: ValidatorStatus[]}},
    ValidatorResponseList,
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get validator identities from state
   *
   * Returns filterable list of validators identities.
   *
   * Identities will be returned for all indices or public keys that match known validators. If an index or public key does not
   * match any known validator, no identity will be returned but this will not cause an error. There are no guarantees for the
   * returned data in terms of ordering.
   */
  postStateValidatorIdentities: Endpoint<
    "POST",
    StateArgs & {
      /** An array of values, with each value either a hex encoded public key (any bytes48 with 0x prefix) or a validator index */
      validatorIds?: ValidatorId[];
    },
    {params: {state_id: string}; body: string[]},
    ValidatorIdentities,
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get validator balances from state
   * Returns filterable list of validator balances.
   */
  getStateValidatorBalances: Endpoint<
    "GET",
    StateArgs & {
      /** Either hex encoded public key (with 0x prefix) or validator index */
      validatorIds?: ValidatorId[];
    },
    {params: {state_id: string}; query: {id?: ValidatorId[]}},
    ValidatorBalanceList,
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get validator balances from state
   * Returns filterable list of validator balances.
   */
  postStateValidatorBalances: Endpoint<
    "POST",
    StateArgs & {
      /** Either hex encoded public key (with 0x prefix) or validator index */
      validatorIds?: ValidatorId[];
    },
    {params: {state_id: string}; body: string[]},
    ValidatorBalanceList,
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get all committees for a state.
   * Retrieves the committees for the given state.
   */
  getEpochCommittees: Endpoint<
    "GET",
    StateArgs & {
      /** Fetch committees for the given epoch. If not present then the committees for the epoch of the state will be obtained. */
      epoch?: Epoch;
      /** Restrict returned values to those matching the supplied committee index. */
      index?: CommitteeIndex;
      /** Restrict returned values to those matching the supplied slot. */
      slot?: Slot;
    },
    {params: {state_id: string}; query: {slot?: number; epoch?: number; index?: number}},
    EpochCommitteeResponseList,
    ExecutionOptimisticAndFinalizedMeta
  >;

  getEpochSyncCommittees: Endpoint<
    "GET",
    StateArgs & {epoch?: Epoch},
    {params: {state_id: string}; query: {epoch?: number}},
    EpochSyncCommitteeResponse,
    ExecutionOptimisticAndFinalizedMeta
  >;
};

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
const stateIdOnlyReq: RequestCodec<Endpoint<"GET", {stateId: StateId}, {params: {state_id: string}}, any, any>> = {
  writeReq: ({stateId}) => ({params: {state_id: stateId.toString()}}),
  parseReq: ({params}) => ({stateId: params.state_id}),
  schema: {params: {state_id: Schema.StringRequired}},
};

export function getDefinitions(_config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    getEpochCommittees: {
      url: "/eth/v1/beacon/states/{state_id}/committees",
      method: "GET",
      req: {
        writeReq: ({stateId, epoch, index, slot}) => ({
          params: {state_id: stateId.toString()},
          query: {epoch, index, slot},
        }),
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
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    getEpochSyncCommittees: {
      url: "/eth/v1/beacon/states/{state_id}/sync_committees",
      method: "GET",
      req: {
        writeReq: ({stateId, epoch}) => ({params: {state_id: stateId.toString()}, query: {epoch}}),
        parseReq: ({params, query}) => ({stateId: params.state_id, epoch: query.epoch}),
        schema: {
          params: {state_id: Schema.StringRequired},
          query: {epoch: Schema.Uint},
        },
      },
      resp: {
        data: EpochSyncCommitteeResponseType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    getStateFinalityCheckpoints: {
      url: "/eth/v1/beacon/states/{state_id}/finality_checkpoints",
      method: "GET",
      req: stateIdOnlyReq,
      resp: {
        data: FinalityCheckpointsType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    getStateFork: {
      url: "/eth/v1/beacon/states/{state_id}/fork",
      method: "GET",
      req: stateIdOnlyReq,
      resp: {
        data: ssz.phase0.Fork,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    getStateRoot: {
      url: "/eth/v1/beacon/states/{state_id}/root",
      method: "GET",
      req: stateIdOnlyReq,
      resp: {
        data: RootResponseType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    getStateRandao: {
      url: "/eth/v1/beacon/states/{state_id}/randao",
      method: "GET",
      req: {
        writeReq: ({stateId, epoch}) => ({params: {state_id: stateId.toString()}, query: {epoch}}),
        parseReq: ({params, query}) => ({stateId: params.state_id, epoch: query.epoch}),
        schema: {
          params: {state_id: Schema.StringRequired},
          query: {epoch: Schema.Uint},
        },
      },
      resp: {
        data: RandaoResponseType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    getStateValidator: {
      url: "/eth/v1/beacon/states/{state_id}/validators/{validator_id}",
      method: "GET",
      req: {
        writeReq: ({stateId, validatorId}) => ({params: {state_id: stateId.toString(), validator_id: validatorId}}),
        parseReq: ({params}) => ({stateId: params.state_id, validatorId: params.validator_id}),
        schema: {
          params: {state_id: Schema.StringRequired, validator_id: Schema.StringRequired},
        },
      },
      resp: {
        onlySupport: WireFormat.json,
        data: ValidatorResponseType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    getStateValidators: {
      url: "/eth/v1/beacon/states/{state_id}/validators",
      method: "GET",
      req: {
        writeReq: ({stateId, validatorIds: id, statuses}) => ({
          params: {state_id: stateId.toString()},
          query: {id, status: statuses},
        }),
        parseReq: ({params, query}) => ({stateId: params.state_id, validatorIds: query.id, statuses: query.status}),
        schema: {
          params: {state_id: Schema.StringRequired},
          query: {id: Schema.UintOrStringArray, status: Schema.StringArray},
        },
      },
      resp: {
        onlySupport: WireFormat.json,
        data: ValidatorResponseListType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    postStateValidators: {
      url: "/eth/v1/beacon/states/{state_id}/validators",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({stateId, validatorIds, statuses}) => ({
          params: {state_id: stateId.toString()},
          body: {
            ids: toValidatorIdsStr(validatorIds),
            statuses,
          },
        }),
        parseReqJson: ({params, body = {}}) => ({
          stateId: params.state_id,
          validatorIds: fromValidatorIdsStr(body.ids),
          statuses: body.statuses,
        }),
        schema: {
          params: {state_id: Schema.StringRequired},
          body: Schema.Object,
        },
      }),
      resp: {
        onlySupport: WireFormat.json,
        data: ValidatorResponseListType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    postStateValidatorIdentities: {
      url: "/eth/v1/beacon/states/{state_id}/validator_identities",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({stateId, validatorIds}) => ({
          params: {state_id: stateId.toString()},
          body: toValidatorIdsStr(validatorIds) || [],
        }),
        parseReqJson: ({params, body = []}) => ({
          stateId: params.state_id,
          validatorIds: fromValidatorIdsStr(body),
        }),
        schema: {
          params: {state_id: Schema.StringRequired},
          body: Schema.UintOrStringArray,
        },
      }),
      resp: {
        data: ValidatorIdentitiesType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    getStateValidatorBalances: {
      url: "/eth/v1/beacon/states/{state_id}/validator_balances",
      method: "GET",
      req: {
        writeReq: ({stateId, validatorIds}) => ({params: {state_id: stateId.toString()}, query: {id: validatorIds}}),
        parseReq: ({params, query}) => ({stateId: params.state_id, validatorIds: query.id}),
        schema: {
          params: {state_id: Schema.StringRequired},
          query: {id: Schema.UintOrStringArray},
        },
      },
      resp: {
        data: ValidatorBalanceListType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    postStateValidatorBalances: {
      url: "/eth/v1/beacon/states/{state_id}/validator_balances",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({stateId, validatorIds}) => ({
          params: {state_id: stateId.toString()},
          body: toValidatorIdsStr(validatorIds) || [],
        }),
        parseReqJson: ({params, body = []}) => ({
          stateId: params.state_id,
          validatorIds: fromValidatorIdsStr(body),
        }),
        schema: {
          params: {state_id: Schema.StringRequired},
          body: Schema.UintOrStringArray,
        },
      }),
      resp: {
        data: ValidatorBalanceListType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
  };
}
