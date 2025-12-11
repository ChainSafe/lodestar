import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_BUILDER} from "@lodestar/params";
import {Slot, electra, ssz} from "@lodestar/types";
import {computeSigningRoot} from "../util/index.ts";

export function getExecutionPayloadSigningRoot(
  state: {config: BeaconConfig; slot: Slot},
  payload: electra.ExecutionPayload
): Uint8Array {
  const domain = state.config.getDomain(state.slot, DOMAIN_BEACON_BUILDER);

  return computeSigningRoot(ssz.electra.ExecutionPayload, payload, domain);
}
