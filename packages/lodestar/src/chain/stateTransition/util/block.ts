/**
 * @module chain/stateTransition/util
 */

import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {hashTreeRoot} from "@chainsafe/ssz";
import {BeaconBlock, BeaconBlockHeader} from "@chainsafe/eth2.0-types";

 /**
  * Receives a block, and produces the accroding blockHeader.
  */
export function blockToHeader(config: IBeaconConfig, block: BeaconBlock): BeaconBlockHeader {
    return {
      stateRoot: block.stateRoot,
      signature: block.signature,
      slot: block.slot,
      parentRoot: block.parentRoot,
      bodyRoot: hashTreeRoot(block.body, config.types.BeaconBlockBody),
    }
  }