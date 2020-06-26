import {SignedBeaconBlock, SignedBeaconHeaderResponse} from "@chainsafe/lodestar-types";
import {blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export function toBeaconHeaderResponse(config: IBeaconConfig, block: SignedBeaconBlock, canonical= false): SignedBeaconHeaderResponse {
  return {
    root: config.types.BeaconBlock.hashTreeRoot(block.message),
    canonical,
    header: {
      message: blockToHeader(config, block.message),
      signature: block.signature
    }
  };
}
