import {RootHex} from "@lodestar/types";
import {describe, expect, it} from "vitest";

import {DataAvailabilityStatus, ExecutionStatus, ProtoArray} from "../../../src/index.js";

describe("ProtoArray", () => {
  it("finalized descendant", () => {
    const genesisSlot = 0;
    const genesisEpoch = 0;

    const stateRoot = "0";
    const finalizedRoot = "1";
    const parentRoot = "1";
    const finalizedDesc = "2";
    const notFinalizedDesc = "3";
    const unknown = "4";
    const fc = ProtoArray.initialize(
      {
        slot: genesisSlot,
        stateRoot,
        parentRoot,
        blockRoot: finalizedRoot,

        justifiedEpoch: genesisEpoch,
        justifiedRoot: stateRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: stateRoot,
        unrealizedJustifiedEpoch: genesisEpoch,
        unrealizedJustifiedRoot: stateRoot,
        unrealizedFinalizedEpoch: genesisEpoch,
        unrealizedFinalizedRoot: stateRoot,

        timeliness: false,

        ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
        dataAvailabilityStatus: DataAvailabilityStatus.PreData,
      },
      genesisSlot
    );

    // Add block that is a finalized descendant.
    fc.onBlock(
      {
        slot: genesisSlot + 1,
        blockRoot: finalizedDesc,
        parentRoot: finalizedRoot,
        stateRoot,
        targetRoot: finalizedRoot,

        justifiedEpoch: genesisEpoch,
        justifiedRoot: stateRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: stateRoot,
        unrealizedJustifiedEpoch: genesisEpoch,
        unrealizedJustifiedRoot: stateRoot,
        unrealizedFinalizedEpoch: genesisEpoch,
        unrealizedFinalizedRoot: stateRoot,

        timeliness: false,

        ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
        dataAvailabilityStatus: DataAvailabilityStatus.PreData,
      },
      genesisSlot + 1
    );

    // Add block that is *not* a finalized descendant.
    fc.onBlock(
      {
        slot: genesisSlot + 1,
        blockRoot: notFinalizedDesc,
        parentRoot: unknown,
        stateRoot,
        targetRoot: finalizedRoot,

        justifiedEpoch: genesisEpoch,
        justifiedRoot: stateRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: stateRoot,
        unrealizedJustifiedEpoch: genesisEpoch,
        unrealizedJustifiedRoot: stateRoot,
        unrealizedFinalizedEpoch: genesisEpoch,
        unrealizedFinalizedRoot: stateRoot,

        timeliness: false,

        ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
        dataAvailabilityStatus: DataAvailabilityStatus.PreData,
      },
      genesisSlot + 1
    );

    // ancestorRoot, descendantRoot, isDescendant
    type Assertion = [RootHex, RootHex, boolean];

    const assertions: Assertion[] = [
      [unknown, unknown, false],
      [unknown, finalizedRoot, false],
      [unknown, finalizedDesc, false],
      [unknown, notFinalizedDesc, false],

      [finalizedRoot, unknown, false],
      [finalizedRoot, finalizedRoot, true],
      [finalizedRoot, finalizedDesc, true],
      [finalizedRoot, notFinalizedDesc, false],

      [finalizedDesc, unknown, false],
      [finalizedDesc, finalizedRoot, false],
      [finalizedDesc, finalizedDesc, true],
      [finalizedDesc, notFinalizedDesc, false],

      [notFinalizedDesc, unknown, false],
      [notFinalizedDesc, finalizedRoot, false],
      [notFinalizedDesc, finalizedDesc, false],
      [notFinalizedDesc, notFinalizedDesc, true],
    ];

    for (const [ancestorRoot, descendantRoot, isDescendant] of assertions) {
      expect(fc.isDescendant(ancestorRoot, descendantRoot)).toBeWithMessage(
        isDescendant,
        `${descendantRoot} must be ${isDescendant ? "descendant" : "not descendant"} of ${ancestorRoot}`
      );
    }
  });
});
