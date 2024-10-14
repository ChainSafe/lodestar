import {describe, it, expect, beforeEach, afterEach, vi, Mocked} from "vitest";
import {EpochDifference, ProtoBlock, ForkChoice} from "@lodestar/fork-choice";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {getShufflingDependentRoot} from "../../../src/util/dependentRoot.js";

vi.mock("@lodestar/fork-choice");

describe("util / getShufflingDependentRoot", () => {
  let forkchoiceStub: Mocked<ForkChoice>;

  const headBattHeadBlock = {
    slot: 100,
  } as ProtoBlock;
  const blockEpoch = computeEpochAtSlot(headBattHeadBlock.slot);

  beforeEach(() => {
    forkchoiceStub = vi.mocked(new ForkChoice({} as any, {} as any, {} as any));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return current dependent root", () => {
    const attEpoch = blockEpoch;
    forkchoiceStub.getDependentRoot.mockImplementation((block, epochDiff) => {
      if (block === headBattHeadBlock && epochDiff === EpochDifference.previous) {
        return "current";
      }
      throw new Error("should not be called");
    });
    expect(getShufflingDependentRoot(forkchoiceStub, attEpoch, blockEpoch, headBattHeadBlock)).toEqual("current");
  });

  it("should return next dependent root", () => {
    const attEpoch = blockEpoch + 1;
    // forkchoiceStub.getDependentRoot.withArgs(headBattHeadBlock, EpochDifference.current).returns("previous");
    forkchoiceStub.getDependentRoot.mockImplementation((block, epochDiff) => {
      if (block === headBattHeadBlock && epochDiff === EpochDifference.current) {
        return "0x000";
      }
      throw new Error("should not be called");
    });
    expect(getShufflingDependentRoot(forkchoiceStub, attEpoch, blockEpoch, headBattHeadBlock)).toEqual("0x000");
  });

  it("should return head block root as dependent root", () => {
    const attEpoch = blockEpoch + 2;
    // forkchoiceStub.getDependentRoot.throws("should not be called");
    forkchoiceStub.getDependentRoot.mockImplementation(() => {
      throw Error("should not be called");
    });
    expect(getShufflingDependentRoot(forkchoiceStub, attEpoch, blockEpoch, headBattHeadBlock)).toEqual(
      headBattHeadBlock.blockRoot
    );
  });

  it("should throw error if attestation epoch is before head block epoch", () => {
    const attEpoch = blockEpoch - 1;
    // forkchoiceStub.getDependentRoot.throws("should not be called");
    forkchoiceStub.getDependentRoot.mockImplementation(() => {
      throw Error("should not be called");
    });
    expect(() => getShufflingDependentRoot(forkchoiceStub, attEpoch, blockEpoch, headBattHeadBlock)).toThrow();
  });
});
