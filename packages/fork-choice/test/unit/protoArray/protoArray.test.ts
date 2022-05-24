import {RootHex} from "@chainsafe/lodestar-types";
import {expect} from "chai";

import {ProtoArray, ExecutionStatus} from "../../../src/index.js";

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
    const fc = ProtoArray.initialize({
      slot: genesisSlot,
      stateRoot,
      parentRoot,
      blockRoot: finalizedRoot,

      justifiedEpoch: genesisEpoch,
      justifiedRoot: stateRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: stateRoot,

      ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
    });

    // Add block that is a finalized descendant.
    fc.onBlock({
      slot: genesisSlot + 1,
      blockRoot: finalizedDesc,
      parentRoot: finalizedRoot,
      stateRoot,
      targetRoot: finalizedRoot,

      justifiedEpoch: genesisEpoch,
      justifiedRoot: stateRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: stateRoot,

      ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
    });

    // Add block that is *not* a finalized descendant.
    fc.onBlock({
      slot: genesisSlot + 1,
      blockRoot: notFinalizedDesc,
      parentRoot: unknown,
      stateRoot,
      targetRoot: finalizedRoot,

      justifiedEpoch: genesisEpoch,
      justifiedRoot: stateRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: stateRoot,

      ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
    });

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
      expect(fc.isDescendant(ancestorRoot, descendantRoot)).to.equal(
        isDescendant,
        `${descendantRoot} must be ${isDescendant ? "descendant" : "not descendant"} of ${ancestorRoot}`
      );
    }
  });
});
