import {ChainForkConfig} from "@lodestar/config";
import {phase0, ssz} from "@lodestar/types";
import {Endpoint, RouteDefinitions} from "../../../utils/types.js";
import {EmptyArgs, EmptyGetRequestCodec, EmptyMeta, EmptyMetaCodec, EmptyRequest} from "../../../utils/codecs.js";
import * as block from "./block.js";
import * as pool from "./pool.js";
import * as state from "./state.js";
import * as rewards from "./rewards.js";

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

// NOTE: We choose to split the block, pool, and state namespaces so the files are not too big.
// However, for a consumer all these methods are within the same service "beacon"

export * as block from "./block.js";
export * as pool from "./pool.js";
export * as state from "./state.js";
export * as rewards from "./rewards.js";
export {BroadcastValidation} from "./block.js";
export type {BlockId, BlockHeaderResponse} from "./block.js";
export type {BlockRewards, SyncCommitteeRewards} from "./rewards.js";
// TODO: Review if re-exporting all these types is necessary
export type {
  StateId,
  ValidatorId,
  ValidatorStatus,
  FinalityCheckpoints,
  ValidatorResponse,
  ValidatorBalance,
  EpochCommitteeResponse,
  EpochSyncCommitteeResponse,
} from "./state.js";

export type Endpoints = block.Endpoints &
  pool.Endpoints &
  state.Endpoints &
  rewards.Endpoints & {
    getGenesis: Endpoint<
      //
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
      req: EmptyGetRequestCodec,
      resp: {
        data: ssz.phase0.Genesis,
        meta: EmptyMetaCodec,
      },
    },
    ...block.getDefinitions(config),
    ...pool.definitions,
    ...state.definitions,
    ...rewards.definitions,
  };
}
