import {generateState} from "../../../../utils/state";
import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {EpochContext, ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {ITreeStateContext} from "../../../../../src/db/api/beacon/stateContextCache";
import {BeaconState} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {getStateRootAncestors, ensureMaxSize} from "../../../../../src/db/api/beacon/checkpointStateCache";

describe("getStateRootAncestors", function () {
  let statesByRoot: Record<string, ITreeStateContext>;
  let stateRootToParent: Record<string, string>;
  let state1: TreeBacked<BeaconState>;
  let state2: TreeBacked<BeaconState>;

  beforeEach(() => {
    statesByRoot = {};
    state1 = generateState();
    state1.slot = 10;
    state2 = generateState();
    state2.slot = 11;
    const epochContext1 = new EpochContext(config);
    statesByRoot[toHexString(state1.hashTreeRoot())] = {
      state: state1,
      epochCtx: epochContext1,
    };
    stateRootToParent = {};
    stateRootToParent[toHexString(state2.hashTreeRoot())] = toHexString(state1.hashTreeRoot());
  });

  it("should return correct state root array", () => {
    const state1Root = state1.hashTreeRoot();
    const state2Root = state2.hashTreeRoot();
    expect(getStateRootAncestors(state2Root, statesByRoot, stateRootToParent)).to.be.deep.equal([state1Root, state2Root]);
    expect(getStateRootAncestors(state1Root, statesByRoot, stateRootToParent)).to.be.deep.equal([state1Root]);
  });

  it("should return null", () => {
    expect(getStateRootAncestors(ZERO_HASH, statesByRoot, stateRootToParent)).to.be.null;
  });
});

describe("ensureMaxSize", function () {
  it("should ensure MAX_SIZE", () => {
    const state1 = generateState();
    state1.slot = 10;
    const state2 = generateState();
    state2.slot = 11;
    // use shared epoch context for testing
    const epochContext = new EpochContext(config);
    const statesByRoot: Record<string, ITreeStateContext> = {};
    statesByRoot[toHexString(state1.hashTreeRoot())] = {
      state: state1,
      epochCtx: epochContext,
    };
    statesByRoot[toHexString(state2.hashTreeRoot())] = {
      state: state2,
      epochCtx: epochContext,
    };
    const finalizedStateRoot = toHexString(state1.hashTreeRoot());
    expect(Object.keys(statesByRoot).length).to.be.equal(2);
    ensureMaxSize(statesByRoot, finalizedStateRoot, 1);
    expect(Object.keys(statesByRoot).length).to.be.equal(1);
    expect(Object.keys(statesByRoot)[0]).to.be.equal(finalizedStateRoot);
    ensureMaxSize(statesByRoot, finalizedStateRoot, 1);
    expect(Object.keys(statesByRoot).length).to.be.equal(1);
    expect(Object.keys(statesByRoot)[0]).to.be.equal(finalizedStateRoot);
  });
});
