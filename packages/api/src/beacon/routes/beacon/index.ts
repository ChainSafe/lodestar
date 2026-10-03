import {ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ArrayOf, Slot, phase0, ssz} from "@lodestar/types";
import {EmptyArgs, EmptyMeta, EmptyMetaCodec, EmptyRequest, EmptyRequestCodec} from "../../../utils/codecs.js";
import {VersionCodec, VersionMeta} from "../../../utils/metadata.js";
import {Schema} from "../../../utils/schema.js";
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
// TODO: Review if re-exporting all these types is necessary
export type {
  BuilderId,
  BuilderResponse,
  BuilderStatus,
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

const SignedProposerPreferencesListType = ArrayOf(ssz.gloas.SignedProposerPreferences);

type SignedProposerPreferencesList = ValueOf<typeof SignedProposerPreferencesListType>;

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

    /**
     * Get proposer preferences
     * Retrieves the signed proposer preferences known by the node for upcoming proposal slots.
     */
    getProposerPreferences: Endpoint<
      "GET",
      {slot?: Slot},
      {query: {slot?: number}},
      SignedProposerPreferencesList,
      VersionMeta
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
    getProposerPreferences: {
      url: "/eth/v1/beacon/proposer_preferences",
      method: "GET",
      req: {
        writeReq: ({slot}) => ({query: {slot}}),
        parseReq: ({query}) => ({slot: query.slot}),
        schema: {query: {slot: Schema.Uint}},
      },
      resp: {
        data: SignedProposerPreferencesListType,
        meta: VersionCodec,
      },
    },
    ...block.getDefinitions(config),
    ...pool.getDefinitions(config),
    ...state.getDefinitions(config),
    ...rewards.getDefinitions(config),
  };
}
