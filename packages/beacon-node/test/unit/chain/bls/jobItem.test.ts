import {describe, expect, it} from "vitest";
import {JobQueueItemSameMessage, jobItemSigSets} from "../../../../src/chain/bls/multithread/jobItem.js";
import {JobQueueItemType} from "../../../../src/chain/bls/multithread/types.js";

describe("jobItemSigSets", () => {
  it("counts every signature in a same-message job", () => {
    const job: JobQueueItemSameMessage = {
      type: JobQueueItemType.sameMessage,
      resolve: () => undefined,
      reject: () => undefined,
      addedTimeMs: 0,
      opts: {},
      sets: Array.from({length: 128}, (_, index) => ({index, signature: new Uint8Array(96)})),
      message: new Uint8Array(32),
    };

    expect(jobItemSigSets(job)).toBe(128);
  });
});
