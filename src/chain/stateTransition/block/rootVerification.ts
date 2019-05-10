/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {hashTreeRoot} from "@chainsafe/ssz";

import {
  BeaconBlock,
  BeaconState,
} from "../../../types";


export default function verifyBlockStateRoot(state: BeaconState, block: BeaconBlock): void {
  assert(block.stateRoot.equals(hashTreeRoot(state, BeaconState)));
}
