import {ContainerType} from "@chainsafe/ssz";
import {ssz, ValidatorIndex} from "@lodestar/types";

import {
  RoutesData,
  ReturnTypes,
  Schema,
  ReqSerializers,
  ContainerDataExecutionOptimistic,
  ArrayOf,
} from "../../../utils/index.js";
import {HttpStatusCode} from "../../../utils/client/httpStatusCode.js";
import {ApiClientResponse} from "../../../interfaces.js";
import {BlockId} from "./block.js";
import {ValidatorId} from "./state.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

/**
 * True if the response references an unverified execution payload. Optimistic information may be invalidated at
 * a later time. If the field is not present, assume the False value.
 */
export type ExecutionOptimistic = boolean;

export type ProposerRewardsResponse = {
  proposerIndex: ValidatorIndex;
  total: number;
  attestations: number;
  syncAggregate: number;
  proposerSlashings: number;
  attesterSlashings: number;
};

export type SyncCommitteeRewardsResponse = {validatorIndex: ValidatorIndex; reward: number}[];

export type Api = {
  /**
   * Get block rewards
   * Returns the info of rewards received by the block proposer
   *
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getProposerRewards(
    blockId: BlockId
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: ProposerRewardsResponse; executionOptimistic: ExecutionOptimistic}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND
    >
  >;
  getSyncCommitteeRewards(
    blockId: BlockId,
    filters?: ValidatorId[]
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: SyncCommitteeRewardsResponse; executionOptimistic: ExecutionOptimistic}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND
    >
  >;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getProposerRewards: {url: "/eth/v1/beacon/rewards/blocks/{block_id}", method: "GET"},
  getSyncCommitteeRewards: {url: "/eth/v1/beacon/rewards/sync_committee/{block_id}", method: "POST"},
};

export type ReqTypes = {
  /* eslint-disable @typescript-eslint/naming-convention */
  getProposerRewards: {params: {block_id: string}};
  getSyncCommitteeRewards: {params: {block_id: string}; body: ValidatorId[]};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getProposerRewards: {
      writeReq: (block_id) => ({params: {block_id: String(block_id)}}),
      parseReq: ({params}) => [params.block_id],
      schema: {params: {block_id: Schema.StringRequired}},
    },
    getSyncCommitteeRewards: {
      writeReq: (block_id, filters) => ({params: {block_id: String(block_id)}, body: filters || []}),
      parseReq: ({params, body}) => [params.block_id, body],
      schema: {
        params: {block_id: Schema.StringRequired},
        body: Schema.UintOrStringArray,
      },
    },
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  const ProposerRewardsResponse = new ContainerType(
    {
      proposerIndex: ssz.ValidatorIndex,
      total: ssz.UintNum64,
      attestations: ssz.UintNum64,
      syncAggregate: ssz.UintNum64,
      proposerSlashings: ssz.UintNum64,
      attesterSlashings: ssz.UintNum64,
    },
    {jsonCase: "eth2"}
  );

  const SyncCommitteeRewards = new ContainerType(
    {
      validatorIndex: ssz.ValidatorIndex,
      reward: ssz.UintNum64,
    },
    {jsonCase: "eth2"}
  );

  return {
    getProposerRewards: ContainerDataExecutionOptimistic(ProposerRewardsResponse),
    getSyncCommitteeRewards: ContainerDataExecutionOptimistic(ArrayOf(SyncCommitteeRewards)),
  };
}
