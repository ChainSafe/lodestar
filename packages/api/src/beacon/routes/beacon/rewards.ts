/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";

import {Schema, Endpoint, RouteDefinitions} from "../../../utils/index.js";
import {ExecutionOptimisticCodec, ExecutionOptimisticMeta, JsonOnlyReq} from "../../../utils/codecs.js";
import {BlockId} from "./block.js";
import {ValidatorId} from "./state.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

const BlockRewardsType = new ContainerType(
  {
    /** Proposer of the block, the proposer index who receives these rewards */
    proposerIndex: ssz.ValidatorIndex,
    /** Total block reward, equal to attestations + sync_aggregate + proposer_slashings + attester_slashings */
    total: ssz.UintNum64,
    /** Block reward component due to included attestations */
    attestations: ssz.UintNum64,
    /** Block reward component due to included sync_aggregate */
    syncAggregate: ssz.UintNum64,
    /** Block reward component due to included proposer_slashings */
    proposerSlashings: ssz.UintNum64,
    /** Block reward component due to included attester_slashings */
    attesterSlashings: ssz.UintNum64,
  },
  {jsonCase: "eth2"}
);

const SyncCommitteeRewardsType = new ContainerType(
  {
    validatorIndex: ssz.ValidatorIndex,
    reward: ssz.UintNum64,
  },
  {jsonCase: "eth2"}
);

/**
 * Rewards info for a single block. Every reward value is in Gwei.
 */
export type BlockRewards = ValueOf<typeof BlockRewardsType>;

/**
 * Rewards info for sync committee participation. Every reward value is in Gwei.
 * Note: In the case that block proposer is present in `SyncCommitteeRewards`, the reward value only reflects rewards for
 * participating in sync committee. Please refer to `BlockRewards.syncAggregate` for rewards of proposer including sync committee
 * outputs into their block
 */
export type SyncCommitteeRewards = ValueOf<typeof SyncCommitteeRewardsType>;

export type Endpoints = {
  /**
   * Get block rewards
   * Returns the info of rewards received by the block proposer
   *
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   */
  getBlockRewards: Endpoint<
    "GET",
    {blockId: BlockId},
    {params: {block_id: string}},
    BlockRewards,
    ExecutionOptimisticMeta
  >;

  /**
   * Get sync committee rewards
   * Returns participant reward value for each sync committee member at the given block.
   *
   * @param blockId Block identifier.
   * Can be one of: "head" (canonical head in node's view), "genesis", "finalized", \<slot\>, \<hex encoded blockRoot with 0x prefix\>.
   * @param validatorIds List of validator indices or pubkeys to filter in
   */
  getSyncCommitteeRewards: Endpoint<
    "POST",
    {blockId: BlockId; validatorIds?: ValidatorId[]},
    {params: {block_id: string}; body: ValidatorId[]},
    SyncCommitteeRewards,
    ExecutionOptimisticMeta
  >;
};

export const definitions: RouteDefinitions<Endpoints> = {
  getBlockRewards: {
    url: "/eth/v1/beacon/rewards/blocks/{block_id}",
    method: "GET",
    req: {
      writeReq: ({blockId}) => ({params: {block_id: String(blockId)}}),
      parseReq: ({params}) => ({blockId: params.block_id}),
      schema: {params: {block_id: Schema.StringRequired}},
    },
    resp: {
      data: BlockRewardsType,
      meta: ExecutionOptimisticCodec,
    },
  },
  getSyncCommitteeRewards: {
    url: "/eth/v1/beacon/rewards/sync_committee/{block_id}",
    method: "POST",
    req: JsonOnlyReq({
      writeReqJson: ({blockId, validatorIds}) => ({
        params: {block_id: String(blockId)},
        body: validatorIds || [],
      }),
      parseReqJson: ({params, body}) => ({
        blockId: params.block_id,
        validatorIds: body,
      }),
      schema: {
        params: {block_id: Schema.StringRequired},
        body: Schema.UintOrStringArray,
      },
    }),
    resp: {
      data: SyncCommitteeRewardsType,
      meta: ExecutionOptimisticCodec,
    },
  },
};
