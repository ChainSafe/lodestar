import {describe, expect, it, vi} from "vitest";
import {IForkChoice, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {RootHex} from "@lodestar/types";
import {recordHeadPayloadInclusionListVerdict} from "../../../src/util/forkChoice.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

describe("recordHeadPayloadInclusionListVerdict", () => {
  const blockRoot = "0x" + "11".repeat(32);
  const parentRoot = "0x" + "22".repeat(32);
  const grandparentRoot = "0x" + "33".repeat(32);
  const ownPayloadHash = "0x" + "aa".repeat(32);
  const ancestorPayloadHash = "0x" + "bb".repeat(32);

  function setup(variants: ProtoBlock[] = []) {
    const recordPayloadInclusionListSatisfaction = vi.fn().mockReturnValue(true);
    const getBlockHexAndBlockHash = vi.fn(
      (root: RootHex, hash: RootHex) =>
        variants.find((block) => block.blockRoot === root && block.executionPayloadBlockHash === hash) ?? null
    );
    const forkChoice = {recordPayloadInclusionListSatisfaction, getBlockHexAndBlockHash} as unknown as IForkChoice;
    return {forkChoice, recordPayloadInclusionListSatisfaction};
  }

  it("records the verdict for a FULL head, whose block hash is its own payload", () => {
    const {forkChoice, recordPayloadInclusionListSatisfaction} = setup();
    const head = generateProtoBlock({
      blockRoot,
      payloadStatus: PayloadStatus.FULL,
      executionPayloadBlockHash: ownPayloadHash,
    });

    expect(recordHeadPayloadInclusionListVerdict(forkChoice, head, false)).toBe(true);
    expect(recordPayloadInclusionListSatisfaction).toHaveBeenCalledExactlyOnceWith(blockRoot, false);
  });

  it.each([PayloadStatus.EMPTY, PayloadStatus.PENDING])(
    "records the verdict for the ancestor payload a %s head carries",
    (payloadStatus) => {
      const parentFull = generateProtoBlock({
        blockRoot: parentRoot,
        parentRoot: grandparentRoot,
        payloadStatus: PayloadStatus.FULL,
        executionPayloadBlockHash: ancestorPayloadHash,
      });
      const {forkChoice, recordPayloadInclusionListSatisfaction} = setup([parentFull]);
      const head = generateProtoBlock({
        blockRoot,
        parentRoot,
        payloadStatus,
        executionPayloadBlockHash: ancestorPayloadHash,
      });

      expect(recordHeadPayloadInclusionListVerdict(forkChoice, head, false)).toBe(true);
      expect(recordPayloadInclusionListSatisfaction).toHaveBeenCalledExactlyOnceWith(parentRoot, false);
    }
  );

  it("walks past EMPTY ancestors to the payload carrying the hash", () => {
    const parentEmpty = generateProtoBlock({
      blockRoot: parentRoot,
      parentRoot: grandparentRoot,
      payloadStatus: PayloadStatus.EMPTY,
      executionPayloadBlockHash: ancestorPayloadHash,
    });
    const grandparentFull = generateProtoBlock({
      blockRoot: grandparentRoot,
      payloadStatus: PayloadStatus.FULL,
      executionPayloadBlockHash: ancestorPayloadHash,
    });
    const {forkChoice, recordPayloadInclusionListSatisfaction} = setup([parentEmpty, grandparentFull]);
    const head = generateProtoBlock({
      blockRoot,
      parentRoot,
      payloadStatus: PayloadStatus.EMPTY,
      executionPayloadBlockHash: ancestorPayloadHash,
    });

    expect(recordHeadPayloadInclusionListVerdict(forkChoice, head, true)).toBe(true);
    expect(recordPayloadInclusionListSatisfaction).toHaveBeenCalledExactlyOnceWith(grandparentRoot, true);
  });

  it("ignores the verdict when the payload block is not in fork choice", () => {
    const {forkChoice, recordPayloadInclusionListSatisfaction} = setup();
    const head = generateProtoBlock({
      blockRoot,
      parentRoot,
      payloadStatus: PayloadStatus.EMPTY,
      executionPayloadBlockHash: ancestorPayloadHash,
    });

    expect(recordHeadPayloadInclusionListVerdict(forkChoice, head, false)).toBe(false);
    expect(recordPayloadInclusionListSatisfaction).not.toHaveBeenCalled();
  });

  it("ignores a missing verdict and an unknown head", () => {
    const {forkChoice, recordPayloadInclusionListSatisfaction} = setup();
    const head = generateProtoBlock({blockRoot, payloadStatus: PayloadStatus.FULL});

    expect(recordHeadPayloadInclusionListVerdict(forkChoice, head, null)).toBe(false);
    expect(recordHeadPayloadInclusionListVerdict(forkChoice, null, true)).toBe(false);
    expect(recordPayloadInclusionListSatisfaction).not.toHaveBeenCalled();
  });
});
