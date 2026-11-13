import {describe, expect, it} from "vitest";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "../../../src/index.js";
import {getPayloadBlockHash, gloasConfig, headSlot, setup} from "./proposerHeadTestUtils.js";

function summarize(blocks: ProtoBlock[]): [string, PayloadStatus][] {
  return blocks.map((block) => [block.blockRoot, block.payloadStatus]);
}

describe("ForkChoice block summaries", () => {
  it("returns a gloas block once as its PENDING variant", () => {
    const {forkChoice, headRoot, parentRoot} = setup({isGloas: true, config: gloasConfig});
    forkChoice.onExecutionPayload(
      headRoot,
      getPayloadBlockHash(headSlot),
      headSlot,
      30_000_000,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );

    expect(summarize(forkChoice.getBlockSummariesByParentRoot(parentRoot))).toEqual([
      [headRoot, PayloadStatus.PENDING],
    ]);
    expect(summarize(forkChoice.getBlockSummariesAtSlot(headSlot))).toEqual([[headRoot, PayloadStatus.PENDING]]);
  });

  it("returns a pre-gloas block as its FULL variant", () => {
    const {forkChoice, headRoot, parentRoot} = setup({isGloas: false, config: gloasConfig});

    expect(summarize(forkChoice.getBlockSummariesByParentRoot(parentRoot))).toEqual([[headRoot, PayloadStatus.FULL]]);
    expect(summarize(forkChoice.getBlockSummariesAtSlot(headSlot))).toEqual([[headRoot, PayloadStatus.FULL]]);
  });
});
