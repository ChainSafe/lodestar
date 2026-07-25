import {SecretKey} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {getExecutionPayloadBidSigningRoot} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";

export function signExecutionPayloadBid(
  config: BeaconConfig,
  secretKey: SecretKey,
  bid: gloas.ExecutionPayloadBid
): gloas.SignedExecutionPayloadBid {
  const signingRoot = getExecutionPayloadBidSigningRoot(config, bid.slot, bid);

  return {
    message: bid,
    signature: secretKey.sign(signingRoot).toBytes(),
  };
}
