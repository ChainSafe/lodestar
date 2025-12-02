import {ChainForkConfig} from "@lodestar/config";
import {phase0, ssz} from "@lodestar/types";
import {EmptyArgs, EmptyMeta, EmptyMetaCodec, EmptyRequest, EmptyRequestCodec} from "../../../utils/codecs.js";
import {Endpoint, RouteDefinitions} from "../../../utils/types.js";
import * as block from "./block.js";
import * as pool from "./pool.js";
import * as rewards from "./rewards.js";
import * as state from "./state.js";

// NOTE: We choose to split the block, pool, state and rewards namespaces so the files are not too big.
// However, for a consumer all these methods are within the same service "beacon"
export {block, pool, state, rewards};

export type {BlockHeaderResponse, BlockId} from "./block.js";
export {BroadcastValidation} from "./block.js";
export type {
  AttestationsRewards,
  BlockRewards,
  IdealAttestationsReward,
  SyncCommitteeRewards,
  TotalAttestationsReward,
} from "./rewards.js";
// TODO: Review if re-exporting all these types is necessary
export type {
  EpochCommitteeResponse,
  EpochSyncCommitteeResponse,
  FinalityCheckpoints,
  StateId,
  ValidatorBalance,
  ValidatorId,
  ValidatorIdentities,
  ValidatorResponse,
  ValidatorStatus,
} from "./state.js";

export type Endpoints = block.Endpoints &
  pool.Endpoints &
  state.Endpoints &
  rewards.Endpoints & {
    getGenesis: Endpoint<
      // ⏎
      "GET",
      EmptyArgs,
      EmptyRequest,
      phase0.Genesis,
      EmptyMeta
    >;
  };

export function getDefinitions(config: ChainForkConfig): RouteDefinitions<Endpoints> {
  return {
    getGenesis: {
      url: "/eth/v1/beacon/genesis",
      method: "GET",
      req: EmptyRequestCodec,
      resp: {
        data: ssz.phase0.Genesis,
        meta: EmptyMetaCodec,
      },
    },
    ...block.getDefinitions(config),
    ...pool.getDefinitions(config),
    ...state.getDefinitions(config),
    ...rewards.getDefinitions(config),
  };
}
