import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_BUILDER} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {CachedBeaconStateGloas} from "../types.js";
import {computeSigningRoot} from "../util/index.js";

export function getExecutionPayloadBidSigningRoot(
  config: BeaconConfig,
  state: CachedBeaconStateGloas,
  bid: gloas.ExecutionPayloadBid
): Uint8Array {
  const domain = config.getDomain(state.slot, DOMAIN_BEACON_BUILDER);

  return computeSigningRoot(ssz.gloas.ExecutionPayloadBid, bid, domain);
}
