import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {fromHexString} from "@chainsafe/ssz";
import {ForkChoice, IForkChoiceStore, ProtoBlock, ProtoArray, ExecutionStatus} from "../../../src/index.js";

describe("Forkchoice", function () {
  const genesisSlot = 0;
  const genesisEpoch = 0;
  const genesisRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";

  const stateRoot = "0xb021a96da54dd89dfafc0e8817e23fe708f5746e924855f49b3f978133c3ac6a";
  const finalizedRoot = "0x86d2ebb56a21be95b9036f4596ff4feaa336acf5fd8739cf39f5d58955b1295b";
  const parentRoot = "0x853d08094d83f1db67159144db54ec0c882eb9715184c4bde8f4191c926a1671";
  const finalizedDesc = "0x37487efdbfbeeb82d7d35c6eb96438c4576f645b0f4c0386184592abab4b1736";

  const protoArr = ProtoArray.initialize(
    {
      slot: genesisSlot,
      stateRoot,
      parentRoot,
      blockRoot: finalizedRoot,

      justifiedEpoch: genesisEpoch,
      justifiedRoot: genesisRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: genesisRoot,

      executionPayloadBlockHash: null,
      executionStatus: ExecutionStatus.PreMerge,
    } as Omit<ProtoBlock, "targetRoot">,
    genesisSlot
  );

  // Add block that is a finalized descendant.
  const block: ProtoBlock = {
    slot: genesisSlot + 1,
    blockRoot: finalizedDesc,
    parentRoot: finalizedRoot,
    stateRoot,
    targetRoot: finalizedRoot,

    justifiedEpoch: genesisEpoch,
    justifiedRoot: genesisRoot,
    finalizedEpoch: genesisEpoch,
    finalizedRoot: genesisRoot,
    unrealizedJustifiedEpoch: genesisEpoch,
    unrealizedJustifiedRoot: genesisRoot,
    unrealizedFinalizedEpoch: genesisEpoch,
    unrealizedFinalizedRoot: genesisRoot,

    executionPayloadBlockHash: null,
    executionStatus: ExecutionStatus.PreMerge,
  };

  const fcStore: IForkChoiceStore = {
    currentSlot: block.slot,
    justified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
      balances: new Uint8Array([32]),
    },
    bestJustified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
      balances: new Uint8Array([32]),
    },
    unrealizedJustified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
      balances: new Uint8Array([32]),
    },
    finalizedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
    unrealizedFinalizedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
    justifiedBalancesGetter: () => new Uint8Array([32]),
  };

  it("getAllAncestorBlocks", function () {
    protoArr.onBlock(block, block.slot);
    const forkchoice = new ForkChoice(config, fcStore, protoArr);
    const summaries = forkchoice.getAllAncestorBlocks(finalizedDesc);
    // there are 2 blocks in protoArray but iterateAncestorBlocks should only return non-finalized blocks
    expect(summaries.length).to.be.equals(1, "should not return the finalized block");
    expect(summaries[0]).to.be.deep.include(block, "the block summary is not correct");
  });
});
