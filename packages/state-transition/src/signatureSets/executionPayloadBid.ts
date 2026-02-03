import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_BUILDER} from "@lodestar/params";
import {Slot, gloas, ssz} from "@lodestar/types";
import {computeSigningRoot} from "../util/index.js";

export function getExecutionPayloadBidSigningRoot(
  config: BeaconConfig,
  stateSlot: Slot,
  bid: gloas.ExecutionPayloadBid
): Uint8Array {
  const domain = config.getDomain(stateSlot, DOMAIN_BEACON_BUILDER);

  return computeSigningRoot(ssz.gloas.ExecutionPayloadBid, bid, domain);
}
