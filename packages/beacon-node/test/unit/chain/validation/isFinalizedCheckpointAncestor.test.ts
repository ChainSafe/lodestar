import {describe, expect, it, vi} from "vitest";
import {ForkChoiceError, ForkChoiceErrorCode, IForkChoice, ProtoNode} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH, ZERO_HASH, ZERO_HASH_HEX} from "@lodestar/params";
import {isFinalizedCheckpointAncestor} from "../../../../src/chain/validation/isFinalizedCheckpointAncestor.js";

describe("finalized checkpoint ancestry", () => {
  const checkpoint = {epoch: 2, root: ZERO_HASH, rootHex: ZERO_HASH_HEX};

  it("compares the ancestor at the finalized checkpoint slot", () => {
    const forkChoice = {
      getAncestor: vi.fn<IForkChoice["getAncestor"]>().mockReturnValue({blockRoot: ZERO_HASH_HEX} as ProtoNode),
    };
    expect(isFinalizedCheckpointAncestor(forkChoice, "descendant", checkpoint)).toBe(true);
    expect(forkChoice.getAncestor).toHaveBeenCalledWith("descendant", 2 * SLOTS_PER_EPOCH);
    forkChoice.getAncestor.mockReturnValue({blockRoot: "conflicting-root"} as ProtoNode);
    expect(isFinalizedCheckpointAncestor(forkChoice, "descendant", checkpoint)).toBe(false);
  });

  it("handles a retained conflicting branch whose ancestor has been pruned", () => {
    const forkChoice = {
      getAncestor: () => {
        throw new ForkChoiceError({
          code: ForkChoiceErrorCode.UNKNOWN_ANCESTOR,
          descendantRoot: "descendant",
          ancestorSlot: 2 * SLOTS_PER_EPOCH,
        });
      },
    };
    expect(isFinalizedCheckpointAncestor(forkChoice, "descendant", checkpoint)).toBe(false);
  });

  it.each([
    new TypeError("unexpected"),
    new ForkChoiceError({code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK, root: "descendant"}),
  ])("does not disguise other fork-choice errors: %s", (error) => {
    const forkChoice = {
      getAncestor: () => {
        throw error;
      },
    };
    expect(() => isFinalizedCheckpointAncestor(forkChoice, "descendant", checkpoint)).toThrow(error);
  });
});
