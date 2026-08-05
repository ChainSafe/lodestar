import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_BUILDER, isForkPostGloas} from "@lodestar/params";
import {ExecutionPayloadBid, Slot, ssz, sszTypesFor} from "@lodestar/types";
import {computeSigningRoot} from "../util/index.js";

export function getExecutionPayloadBidSigningRoot(
  config: BeaconConfig,
  stateSlot: Slot,
  bid: ExecutionPayloadBid
): Uint8Array {
  const fork = config.getForkName(stateSlot);
  const domain = config.getDomain(stateSlot, DOMAIN_BEACON_BUILDER);
  const sszType = isForkPostGloas(fork) ? sszTypesFor(fork).ExecutionPayloadBid : ssz.gloas.ExecutionPayloadBid;

  return computeSigningRoot(sszType, bid, domain);
}
