import {describe, expect, it} from "vitest";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ExecutionStatus, PayloadStatus, ProtoArray} from "../../../src/index.js";

/** Block metadata shared by every test node */
function blockFields(overrides: {
  slot: number;
  blockRoot: string;
  parentRoot: string;
  payloadStatus?: PayloadStatus;
}): Parameters<ProtoArray["onBlock"]>[0] {
  return {
    slot: overrides.slot,
    blockRoot: overrides.blockRoot,
    parentRoot: overrides.parentRoot,
    stateRoot: "0",
    targetRoot: "1",

    justifiedEpoch: 0,
    justifiedRoot: "0",
    finalizedEpoch: 0,
    finalizedRoot: "0",
    unrealizedJustifiedEpoch: 0,
    unrealizedJustifiedRoot: "0",
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: "0",

    timeliness: false,
    importedTimely: false,
    ptcTimeliness: false,
    proposerIndex: 0,

    ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
    dataAvailabilityStatus: DataAvailabilityStatus.PreData,

    parentBlockHash: null,
    payloadStatus: overrides.payloadStatus ?? PayloadStatus.FULL,
  };
}

function initProtoArray(): ProtoArray {
  return ProtoArray.initialize(
    {
      ...blockFields({slot: 0, blockRoot: "1", parentRoot: "1"}),
      stateRoot: "0",
    } as Parameters<typeof ProtoArray.initialize>[0],
    0
  );
}

describe("ProtoArray.getViableHeads", () => {
  it("returns every viable leaf with exact Gwei weight", () => {
    const fc = initProtoArray();
    // 1 <- 2 <- 3 and 1 <- 4 (two competing leaves)
    fc.onBlock(blockFields({slot: 1, blockRoot: "2", parentRoot: "1"}), 1, null);
    fc.onBlock(blockFields({slot: 2, blockRoot: "3", parentRoot: "2"}), 2, null);
    fc.onBlock(blockFields({slot: 1, blockRoot: "4", parentRoot: "1"}), 2, null);

    // Non-leaf "2" must be excluded; genesis "1" has viable children => excluded
    fc.applyScoreChanges({
      attestationDeltas: [0, 0, 30, 12],
      proposerBoost: null,
      justifiedEpoch: 0,
      justifiedRoot: "0",
      finalizedEpoch: 0,
      finalizedRoot: "0",
      currentSlot: 2,
    });

    const heads = fc.getViableHeads(2).sort((a, b) => a.root.localeCompare(b.root));
    expect(heads).toEqual([
      {root: "3", payloadStatus: PayloadStatus.FULL, weight: 30_000_000_000n},
      {root: "4", payloadStatus: PayloadStatus.FULL, weight: 12_000_000_000n},
    ]);
  });

  it("emits gloas payload-status variants of one root as separate entries", () => {
    const fc = initProtoArray();
    // A gloas block (parentBlockHash !== null) creates PENDING and EMPTY variants sharing
    // blockRoot "2" at insertion
    fc.onBlock(
      {
        ...blockFields({slot: 1, blockRoot: "2", parentRoot: "1", payloadStatus: PayloadStatus.PENDING}),
        ...{
          executionPayloadBlockHash: "0xeb",
          executionPayloadNumber: 1,
          executionPayloadGasLimit: 30_000_000,
          executionStatus: ExecutionStatus.Valid,
        },
        parentBlockHash: "0xea",
      },
      1,
      null
    );

    // Before the envelope arrives only the EMPTY variant is a leaf (PENDING's bestChild
    // points at it, so PENDING itself is not a leaf)
    expect(fc.getViableHeads(1)).toEqual([{root: "2", payloadStatus: PayloadStatus.EMPTY, weight: 0n}]);

    // Revealing the payload creates the FULL variant as a sibling leaf of EMPTY
    fc.onExecutionPayload("2", 1, "0xeb", 1, 30_000_000, null, ExecutionStatus.Valid, DataAvailabilityStatus.Available);

    // Every leaf variant is reported separately, never deduped by root (consensus-specs #5393)
    const heads = fc.getViableHeads(1);
    const variantsOfRoot2 = heads.filter((h) => h.root === "2");
    expect(variantsOfRoot2.map((h) => h.payloadStatus).sort()).toEqual([PayloadStatus.EMPTY, PayloadStatus.FULL]);
  });
});
