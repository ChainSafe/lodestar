import {Mocked, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {EpochDifference, ForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {IBeaconStateView, computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getInclusionListDependentRootFromState, getShufflingDependentRoot} from "../../../src/util/dependentRoot.js";

vi.mock("@lodestar/fork-choice");

describe("util / getShufflingDependentRoot", () => {
  let forkchoiceStub: Mocked<ForkChoice>;

  const headBattHeadBlock = {
    slot: 100,
  } as ProtoBlock;
  const blockEpoch = computeEpochAtSlot(headBattHeadBlock.slot);

  beforeEach(() => {
    forkchoiceStub = vi.mocked(new ForkChoice({} as any, {} as any, {} as any, {} as any, {} as any));
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

describe("util / getInclusionListDependentRootFromState", () => {
  const rootAtSlot = (slot: Slot): Uint8Array => {
    const root = new Uint8Array(32);
    new DataView(root.buffer).setUint32(0, slot);
    return root;
  };
  const state = {getBlockRootAtSlot: rootAtSlot} as unknown as IBeaconStateView;

  it("should resolve the dependent root of the first block of an epoch", () => {
    // payload of the first block of epoch 249 checks the inclusion lists of the last slot of epoch 248,
    // whose dependent slot is the last slot of epoch 246, below a checkpoint sync anchor at that block
    const inclusionListSlot = computeStartSlotAtEpoch(249) - 1;
    expect(getInclusionListDependentRootFromState(state, inclusionListSlot)).toEqual(
      toRootHex(rootAtSlot(computeStartSlotAtEpoch(247) - 1))
    );
  });

  it("should resolve the dependent root of a block within an epoch", () => {
    const inclusionListSlot = computeStartSlotAtEpoch(249) + 1;
    expect(getInclusionListDependentRootFromState(state, inclusionListSlot)).toEqual(
      toRootHex(rootAtSlot(computeStartSlotAtEpoch(248) - 1))
    );
  });

  it("should return the genesis block root close to genesis", () => {
    for (const inclusionListSlot of [0, 1, SLOTS_PER_EPOCH, 2 * SLOTS_PER_EPOCH - 1]) {
      expect(getInclusionListDependentRootFromState(state, inclusionListSlot)).toEqual(toRootHex(rootAtSlot(0)));
    }
  });
});
