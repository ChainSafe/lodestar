import {ChainForkConfig} from "@lodestar/config";
import {Epoch, rewards} from "@lodestar/types";
import {JsonOnlyReq} from "../../../utils/codecs.js";
import {Endpoint, RouteDefinitions, Schema} from "../../../utils/index.js";
import {ExecutionOptimisticAndFinalizedCodec, ExecutionOptimisticAndFinalizedMeta} from "../../../utils/metadata.js";
import {fromValidatorIdsStr, toValidatorIdsStr} from "../../../utils/serdes.js";
import {BlockArgs} from "./block.js";
import {ValidatorId} from "./state.js";

export type Endpoints = {
  /**
   * Get block rewards
   * Returns the info of rewards received by the block proposer
   */
  getBlockRewards: Endpoint<
    "GET",
    BlockArgs,
    {params: {block_id: string}},
    rewards.BlockRewards,
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get attestations rewards
   * Negative values indicate penalties. `inactivity` can only be either 0 or negative number since it is penalty only
   */
  getAttestationsRewards: Endpoint<
    "POST",
    {
      /** The epoch to get rewards info from */
      epoch: Epoch;
      /** List of validator indices or pubkeys to filter in */
      validatorIds?: ValidatorId[];
    },
    {params: {epoch: number}; body: string[]},
    rewards.AttestationsRewards,
    ExecutionOptimisticAndFinalizedMeta
  >;

  /**
   * Get sync committee rewards
   * Returns participant reward value for each sync committee member at the given block.
   */
  getSyncCommitteeRewards: Endpoint<
    "POST",
    BlockArgs & {
      /** List of validator indices or pubkeys to filter in */
      validatorIds?: ValidatorId[];
    },
    {params: {block_id: string}; body: string[]},
    rewards.SyncCommitteeRewards,
    ExecutionOptimisticAndFinalizedMeta
  >;
};

export function getDefinitions(_config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    getBlockRewards: {
      url: "/eth/v1/beacon/rewards/blocks/{block_id}",
      method: "GET",
      req: {
        writeReq: ({blockId}) => ({params: {block_id: blockId.toString()}}),
        parseReq: ({params}) => ({blockId: params.block_id}),
        schema: {params: {block_id: Schema.StringRequired}},
      },
      resp: {
        data: rewards.BlockRewardsType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    getAttestationsRewards: {
      url: "/eth/v1/beacon/rewards/attestations/{epoch}",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({epoch, validatorIds}) => ({
          params: {epoch},
          body: toValidatorIdsStr(validatorIds) || [],
        }),
        parseReqJson: ({params, body}) => ({
          epoch: params.epoch,
          validatorIds: fromValidatorIdsStr(body),
        }),
        schema: {
          params: {epoch: Schema.UintRequired},
          body: Schema.UintOrStringArray,
        },
      }),
      resp: {
        data: rewards.AttestationsRewardsType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
    getSyncCommitteeRewards: {
      url: "/eth/v1/beacon/rewards/sync_committee/{block_id}",
      method: "POST",
      req: JsonOnlyReq({
        writeReqJson: ({blockId, validatorIds}) => ({
          params: {block_id: blockId.toString()},
          body: toValidatorIdsStr(validatorIds) || [],
        }),
        parseReqJson: ({params, body}) => ({
          blockId: params.block_id,
          validatorIds: fromValidatorIdsStr(body),
        }),
        schema: {
          params: {block_id: Schema.StringRequired},
          body: Schema.UintOrStringArray,
        },
      }),
      resp: {
        data: rewards.SyncCommitteeRewardsType,
        meta: ExecutionOptimisticAndFinalizedCodec,
      },
    },
  };
}
