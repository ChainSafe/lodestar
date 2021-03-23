import {expect} from "chai";

import {ProtoArray} from "../../../src/protoArray";

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
      finalizedEpoch: genesisEpoch,
    });

    // Add block that is a finalized descendant.
    fc.onBlock({
      slot: genesisSlot + 1,
      blockRoot: finalizedDesc,
      parentRoot: finalizedRoot,
      stateRoot,
      targetRoot: finalizedRoot,
      justifiedEpoch: genesisEpoch,
      finalizedEpoch: genesisEpoch,
    });

    // Add block that is *not* a finalized descendant.
    fc.onBlock({
      slot: genesisSlot + 1,
      blockRoot: notFinalizedDesc,
      parentRoot: unknown,
      stateRoot,
      targetRoot: finalizedRoot,
      justifiedEpoch: genesisEpoch,
      finalizedEpoch: genesisEpoch,
    });

    expect(fc.isDescendant(unknown, unknown)).to.be.false;
    expect(fc.isDescendant(unknown, finalizedRoot)).to.be.false;
    expect(fc.isDescendant(unknown, finalizedDesc)).to.be.false;
    expect(fc.isDescendant(unknown, notFinalizedDesc)).to.be.false;

    expect(fc.isDescendant(finalizedRoot, unknown)).to.be.false;
    expect(fc.isDescendant(finalizedRoot, finalizedRoot)).to.be.true;
    expect(fc.isDescendant(finalizedRoot, finalizedDesc)).to.be.true;
    expect(fc.isDescendant(finalizedRoot, notFinalizedDesc)).to.be.false;

    expect(fc.isDescendant(finalizedDesc, unknown)).to.be.false;
    expect(fc.isDescendant(finalizedDesc, finalizedRoot)).to.be.false;
    expect(fc.isDescendant(finalizedDesc, finalizedDesc)).to.be.true;
    expect(fc.isDescendant(finalizedDesc, notFinalizedDesc)).to.be.false;

    expect(fc.isDescendant(notFinalizedDesc, unknown)).to.be.false;
    expect(fc.isDescendant(notFinalizedDesc, finalizedRoot)).to.be.false;
    expect(fc.isDescendant(notFinalizedDesc, finalizedDesc)).to.be.false;
    expect(fc.isDescendant(notFinalizedDesc, notFinalizedDesc)).to.be.true;
  });
});
