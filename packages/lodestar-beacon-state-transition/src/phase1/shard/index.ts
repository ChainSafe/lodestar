import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Phase1} from "@chainsafe/lodestar-types";
import {computePreviousSlot} from "../misc";
import {GENESIS_SLOT} from "../../constants";
import {processCrosslink} from "./crosslink";
import {assert} from "@chainsafe/lodestar-utils";
import {verifyEmptyShardTransition} from "./transition";
export * from "./crosslink";
export * from "./transition";

export function processShardTransitions(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  shardTransitions: Phase1.ShardTransition[],
  attestations: Phase1.Attestation[]
): void {
  if (computePreviousSlot(state.slot) > GENESIS_SLOT) {
    processCrosslink(config, state, shardTransitions, attestations);
  }
  assert.true(verifyEmptyShardTransition(config, state, shardTransitions));
}
