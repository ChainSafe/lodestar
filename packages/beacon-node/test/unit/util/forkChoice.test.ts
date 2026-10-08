import {describe, expect, it, vi} from "vitest";
import {IForkChoice, PayloadStatus} from "@lodestar/fork-choice";
import {recordHeadPayloadInclusionListVerdict} from "../../../src/util/forkChoice.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

describe("recordHeadPayloadInclusionListVerdict", () => {
  const blockRoot = "0x" + "11".repeat(32);
  const ownPayloadHash = "0x" + "aa".repeat(32);
  const ancestorPayloadHash = "0x" + "bb".repeat(32);

  function setup() {
    const recordPayloadInclusionListSatisfaction = vi.fn().mockReturnValue(true);
    const forkChoice = {recordPayloadInclusionListSatisfaction} as unknown as IForkChoice;
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
    "ignores the verdict for a %s head, whose block hash belongs to an ancestor payload",
    (payloadStatus) => {
      const {forkChoice, recordPayloadInclusionListSatisfaction} = setup();
      const head = generateProtoBlock({blockRoot, payloadStatus, executionPayloadBlockHash: ancestorPayloadHash});

      expect(recordHeadPayloadInclusionListVerdict(forkChoice, head, false)).toBe(false);
      expect(recordPayloadInclusionListSatisfaction).not.toHaveBeenCalled();
    }
  );

  it("ignores a missing verdict and an unknown head", () => {
    const {forkChoice, recordPayloadInclusionListSatisfaction} = setup();
    const head = generateProtoBlock({blockRoot, payloadStatus: PayloadStatus.FULL});

    expect(recordHeadPayloadInclusionListVerdict(forkChoice, head, null)).toBe(false);
    expect(recordHeadPayloadInclusionListVerdict(forkChoice, null, true)).toBe(false);
    expect(recordPayloadInclusionListSatisfaction).not.toHaveBeenCalled();
  });
});
