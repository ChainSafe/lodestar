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

/**
 * Rewards info for a single block. Every reward value is in Gwei.
 */
export type BlockRewards = {
  /** Proposer of the block, the proposer index who receives these rewards */
  proposerIndex: ValidatorIndex;
  /** Total block reward, equal to attestations + sync_aggregate + proposer_slashings + attester_slashings */
  total: number;
  /** Block reward component due to included attestations */
  attestations: number;
  /** Block reward component due to included sync_aggregate */
  syncAggregate: number;
  /** Block reward component due to included proposer_slashings */
  proposerSlashings: number;
  /** Block reward component due to included attester_slashings */
  attesterSlashings: number;
};

/**
 * Rewards info for sync committee participation. Every reward value is in Gwei.
 * Note: In the case that block proposer is present in `SyncCommitteeRewards`, the reward value only reflects rewards for
 * participating in sync committee. Please refer to `BlockRewards.syncAggregate` for rewards of proposer including sync committee
 * outputs into their block
 */
export type SyncCommitteeRewards = {validatorIndex: ValidatorIndex; reward: number}[];

export type Api = {
  /**
   * Get block rewards
   * Returns the info of rewards received by the block proposer
   *
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockRewards(
    blockId: BlockId
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: BlockRewards; executionOptimistic: ExecutionOptimistic}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND
    >
  >;

  /**
   * Get sync committee rewards
   * Returns participant reward value for each sync committee member at the given block.
   *
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   * @param validatorIds List of validator indices or pubkeys to filter in
   */
  getSyncCommitteeRewards(
    blockId: BlockId,
    validatorIds?: ValidatorId[]
  ): Promise<
    ApiClientResponse<
      {[HttpStatusCode.OK]: {data: SyncCommitteeRewards; executionOptimistic: ExecutionOptimistic}},
      HttpStatusCode.BAD_REQUEST | HttpStatusCode.NOT_FOUND
    >
  >;
};

/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getBlockRewards: {url: "/eth/v1/beacon/rewards/blocks/{block_id}", method: "GET"},
  getSyncCommitteeRewards: {url: "/eth/v1/beacon/rewards/sync_committee/{block_id}", method: "POST"},
};

export type ReqTypes = {
  /* eslint-disable @typescript-eslint/naming-convention */
  getBlockRewards: {params: {block_id: string}};
  getSyncCommitteeRewards: {params: {block_id: string}; body: ValidatorId[]};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getBlockRewards: {
      writeReq: (block_id) => ({params: {block_id: String(block_id)}}),
      parseReq: ({params}) => [params.block_id],
      schema: {params: {block_id: Schema.StringRequired}},
    },
    getSyncCommitteeRewards: {
      writeReq: (block_id, validatorIds) => ({params: {block_id: String(block_id)}, body: validatorIds || []}),
      parseReq: ({params, body}) => [params.block_id, body],
      schema: {
        params: {block_id: Schema.StringRequired},
        body: Schema.UintOrStringArray,
      },
    },
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  const BlockRewardsResponse = new ContainerType(
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

  const SyncCommitteeRewardsResponse = new ContainerType(
    {
      validatorIndex: ssz.ValidatorIndex,
      reward: ssz.UintNum64,
    },
    {jsonCase: "eth2"}
  );

  return {
    getBlockRewards: ContainerDataExecutionOptimistic(BlockRewardsResponse),
    getSyncCommitteeRewards: ContainerDataExecutionOptimistic(ArrayOf(SyncCommitteeRewardsResponse)),
  };
}
