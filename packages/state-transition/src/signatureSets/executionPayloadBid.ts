import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_BUILDER, isForkPostGloas} from "@lodestar/params";
import {ExecutionPayloadBid, ssz, sszTypesFor} from "@lodestar/types";
import {computeSigningRoot} from "../util/index.js";

export function getExecutionPayloadBidSigningRoot(config: BeaconConfig, bid: ExecutionPayloadBid): Uint8Array {
  const fork = config.getForkName(bid.slot);
  const domain = config.getDomain(bid.slot, DOMAIN_BEACON_BUILDER);
  const sszType = isForkPostGloas(fork) ? sszTypesFor(fork).ExecutionPayloadBid : ssz.gloas.ExecutionPayloadBid;

  return computeSigningRoot(sszType, bid, domain);
}
