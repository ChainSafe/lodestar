import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_BUILDER, type ForkPostGloas} from "@lodestar/params";
import {ExecutionPayloadBid, Slot, sszTypesFor} from "@lodestar/types";
import {computeSigningRoot} from "../util/index.js";

export function getExecutionPayloadBidSigningRoot(
  config: BeaconConfig,
  stateSlot: Slot,
  bid: ExecutionPayloadBid
): Uint8Array {
  const domain = config.getDomain(stateSlot, DOMAIN_BEACON_BUILDER);
  const sszType = sszTypesFor(config.getForkName(stateSlot) as ForkPostGloas, "ExecutionPayloadBid");

  return computeSigningRoot(sszType, bid, domain);
}
