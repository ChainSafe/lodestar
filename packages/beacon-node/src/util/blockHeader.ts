import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {blockToHeader} from "@lodestar/state-transition";
import {SignedBeaconBlock} from "@lodestar/types";

/** Source: unstable@9cb14e3381 api/impl/beacon/blocks/utils.ts#toBeaconHeaderResponse. */
export function toBeaconHeaderResponse(
  config: ChainForkConfig,
  block: SignedBeaconBlock,
  canonical = false
): routes.beacon.BlockHeaderResponse {
  return {
    root: config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message),
    canonical,
    header: {
      message: blockToHeader(config, block.message),
      signature: block.signature,
    },
  };
}
