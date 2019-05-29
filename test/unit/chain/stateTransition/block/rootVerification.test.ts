import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import verifyBlockStateRoot from "../../../../../src/chain/stateTransition/block/rootVerification";
import {expect} from "chai";
import {hashTreeRoot} from "@chainsafe/ssz";
import {BeaconState} from "../../../../../src/types";

describe('process block - root verification', function () {

  it('should fail on invalid root', function () {
    const state = generateState({slot: 23});
    const block = generateEmptyBlock();
    try {
      verifyBlockStateRoot(state, block);
      expect.fail();
    } catch (e) {

    }
  });

  it('should not fail on correct root root', function () {
    const state = generateState({slot: 23});
    const block = generateEmptyBlock();
    block.stateRoot = hashTreeRoot(state, BeaconState);
    try {
      verifyBlockStateRoot(state, block);
      expect.fail();
    } catch (e) {

    }
  });

});
