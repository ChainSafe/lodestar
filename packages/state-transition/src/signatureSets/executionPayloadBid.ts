import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_BUILDER, ForkSeq} from "@lodestar/params";
import {ExecutionPayloadBid, Slot, ssz} from "@lodestar/types";
import {computeSigningRoot} from "../util/index.js";

export function getExecutionPayloadBidSigningRoot(
  config: BeaconConfig,
  stateSlot: Slot,
  bid: ExecutionPayloadBid
): Uint8Array {
  const domain = config.getDomain(stateSlot, DOMAIN_BEACON_BUILDER);
  const sszType =
    config.getForkSeq(stateSlot) >= ForkSeq.heze ? ssz.heze.ExecutionPayloadBid : ssz.gloas.ExecutionPayloadBid;

  return computeSigningRoot(sszType, bid, domain);
}
