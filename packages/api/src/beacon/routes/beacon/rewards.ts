/* eslint-disable @typescript-eslint/naming-convention */
import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {Epoch, ssz} from "@lodestar/types";

import {Schema, Endpoint, RouteDefinitions} from "../../../utils/index.js";
import {ArrayOf, ExecutionOptimisticCodec, ExecutionOptimisticMeta, JsonOnlyReq} from "../../../utils/codecs.js";
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

const AttestationsRewardType = new ContainerType(
  {
    /** Reward for head vote. Could be negative to indicate penalty */
    head: ssz.UintNum64,
    /** Reward for target vote. Could be negative to indicate penalty */
    target: ssz.UintNum64,
    /** Reward for source vote. Could be negative to indicate penalty */
    source: ssz.UintNum64,
    /** Inclusion delay reward (phase0 only) */
    inclusionDelay: ssz.UintNum64,
    /** Inactivity penalty. Should be a negative number to indicate penalty */
    inactivity: ssz.UintNum64,
  },
  {jsonCase: "eth2"}
);

const IdealAttestationsRewardsType = new ContainerType(
  {
    ...AttestationsRewardType.fields,
    effectiveBalance: ssz.UintNum64,
  },
  {jsonCase: "eth2"}
);

const TotalAttestationsRewardsType = new ContainerType(
  {
    ...AttestationsRewardType.fields,
    validatorIndex: ssz.ValidatorIndex,
  },
  {jsonCase: "eth2"}
);

const AttestationsRewardsType = new ContainerType(
  {
    idealRewards: ArrayOf(IdealAttestationsRewardsType),
    totalRewards: ArrayOf(TotalAttestationsRewardsType),
  },
  {jsonCase: "eth2"}
);

const SyncCommitteeRewardsType = ArrayOf(
  new ContainerType(
    {
      validatorIndex: ssz.ValidatorIndex,
      reward: ssz.UintNum64,
    },
    {jsonCase: "eth2"}
  )
);

/**
 * True if the response references the finalized history of the chain, as determined by fork choice.
 */
export type Finalized = boolean;

/**
 * Rewards info for a single block. Every reward value is in Gwei.
 */
export type BlockRewards = ValueOf<typeof BlockRewardsType>;

/**
 * Rewards for a single set of (ideal or actual depending on usage) attestations. Reward value is in Gwei
 */
export type AttestationsReward = ValueOf<typeof AttestationsRewardType>;

/**
 * Rewards info for ideal attestations ie. Maximum rewards could be earned by making timely head, target and source vote.
 * `effectiveBalance` is in Gwei
 */
export type IdealAttestationsReward = ValueOf<typeof IdealAttestationsRewardsType>;

/**
 * Rewards info for actual attestations
 */
export type TotalAttestationsReward = ValueOf<typeof TotalAttestationsRewardsType>;

export type AttestationsRewards = ValueOf<typeof AttestationsRewardsType>;

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
   * Get attestations rewards
   * Negative values indicate penalties. `inactivity` can only be either 0 or negative number since it is penalty only
   *
   * @param epoch The epoch to get rewards info from
   * @param validatorIds List of validator indices or pubkeys to filter in
   */
  getAttestationsRewards: Endpoint<
    "POST",
    {epoch: Epoch; validatorIds?: ValidatorId[]},
    {params: {epoch: number}; body: ValidatorId[]},
    AttestationsRewards,
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
      writeReq: ({blockId}) => ({params: {block_id: blockId.toString()}}),
      parseReq: ({params}) => ({blockId: params.block_id}),
      schema: {params: {block_id: Schema.StringRequired}},
    },
    resp: {
      data: BlockRewardsType,
      meta: ExecutionOptimisticCodec,
    },
  },
  getAttestationsRewards: {
    url: "/eth/v1/beacon/rewards/attestations/{epoch}",
    method: "POST",
    req: JsonOnlyReq({
      writeReqJson: ({epoch, validatorIds}) => ({
        params: {epoch},
        body: validatorIds || [],
      }),
      parseReqJson: ({params, body}) => ({
        epoch: params.epoch,
        validatorIds: body,
      }),
      schema: {
        params: {epoch: Schema.UintRequired},
        body: Schema.UintOrStringArray,
      },
    }),
    resp: {
      data: AttestationsRewardsType,
      meta: ExecutionOptimisticCodec,
    },
  },
  getSyncCommitteeRewards: {
    url: "/eth/v1/beacon/rewards/sync_committee/{block_id}",
    method: "POST",
    req: JsonOnlyReq({
      writeReqJson: ({blockId, validatorIds}) => ({
        params: {block_id: blockId.toString()},
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
