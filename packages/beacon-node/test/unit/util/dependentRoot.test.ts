import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {EpochDifference, ProtoBlock} from "@lodestar/fork-choice";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {getShufflingDependentRoot} from "../../../src/util/dependentRoot.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../__mocks__/mockedBeaconChain.js";

describe("util / getShufflingDependentRoot", () => {
  let forkchoiceStub: MockedBeaconChain["forkChoice"];

  const headBattHeadBlock = {
    slot: 100,
  } as ProtoBlock;
  const blockEpoch = computeEpochAtSlot(headBattHeadBlock.slot);

  beforeEach(() => {
    forkchoiceStub = getMockedBeaconChain().forkChoice;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return current dependent root", () => {
    const attEpoch = blockEpoch;
    forkchoiceStub.getDependentRoot.mockImplementation((block, epochDiff) => {
      if (block === headBattHeadBlock && epochDiff === EpochDifference.previous) {
        return "current";
      } else {
        throw new Error("should not be called");
      }
    });
    expect(getShufflingDependentRoot(forkchoiceStub, attEpoch, blockEpoch, headBattHeadBlock)).to.be.equal("current");
  });

  it("should return next dependent root", () => {
    const attEpoch = blockEpoch + 1;
    // forkchoiceStub.getDependentRoot.withArgs(headBattHeadBlock, EpochDifference.current).returns("previous");
    forkchoiceStub.getDependentRoot.mockImplementation((block, epochDiff) => {
      if (block === headBattHeadBlock && epochDiff === EpochDifference.current) {
        return "0x000";
      } else {
        throw new Error("should not be called");
      }
    });
    expect(getShufflingDependentRoot(forkchoiceStub, attEpoch, blockEpoch, headBattHeadBlock)).to.be.equal("0x000");
  });

  it("should return head block root as dependent root", () => {
    const attEpoch = blockEpoch + 2;
    // forkchoiceStub.getDependentRoot.throws("should not be called");
    forkchoiceStub.getDependentRoot.mockImplementation(() => {
      throw Error("should not be called");
    });
    expect(getShufflingDependentRoot(forkchoiceStub, attEpoch, blockEpoch, headBattHeadBlock)).to.be.equal(
      headBattHeadBlock.blockRoot
    );
  });

  it("should throw error if attestation epoch is before head block epoch", () => {
    const attEpoch = blockEpoch - 1;
    // forkchoiceStub.getDependentRoot.throws("should not be called");
    forkchoiceStub.getDependentRoot.mockImplementation(() => {
      throw Error("should not be called");
    });
    expect(() => getShufflingDependentRoot(forkchoiceStub, attEpoch, blockEpoch, headBattHeadBlock)).to.throw();
  });
});
