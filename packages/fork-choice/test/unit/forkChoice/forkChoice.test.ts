import {ForkChoice, IForkChoiceStore, IProtoBlock, ProtoArray, ExecutionStatus} from "../../../src";
import {config} from "@chainsafe/lodestar-config/default";
import {expect} from "chai";
import {fromHexString} from "@chainsafe/ssz";
import {getEffectiveBalanceIncrementsZeroed} from "@chainsafe/lodestar-beacon-state-transition";

describe("Forkchoice", function () {
  const genesisSlot = 0;
  const genesisEpoch = 0;
  const genesisRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";

  const stateRoot = "0xb021a96da54dd89dfafc0e8817e23fe708f5746e924855f49b3f978133c3ac6a";
  const finalizedRoot = "0x86d2ebb56a21be95b9036f4596ff4feaa336acf5fd8739cf39f5d58955b1295b";
  const parentRoot = "0x853d08094d83f1db67159144db54ec0c882eb9715184c4bde8f4191c926a1671";
  const finalizedDesc = "0x37487efdbfbeeb82d7d35c6eb96438c4576f645b0f4c0386184592abab4b1736";

  const protoArr = ProtoArray.initialize({
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
  } as Omit<IProtoBlock, "targetRoot">);

  // Add block that is a finalized descendant.
  const block: IProtoBlock = {
    slot: genesisSlot + 1,
    blockRoot: finalizedDesc,
    parentRoot: finalizedRoot,
    stateRoot,
    targetRoot: finalizedRoot,

    justifiedEpoch: genesisEpoch,
    justifiedRoot: genesisRoot,
    finalizedEpoch: genesisEpoch,
    finalizedRoot: genesisRoot,

    executionPayloadBlockHash: null,
    executionStatus: ExecutionStatus.PreMerge,
  };

  const fcStore: IForkChoiceStore = {
    currentSlot: block.slot,
    justifiedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
    finalizedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
    bestJustifiedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
  };

  it("getAllAncestorBlocks", function () {
    protoArr.onBlock(block);
    const forkchoice = new ForkChoice(config, fcStore, protoArr, getEffectiveBalanceIncrementsZeroed(0), false);
    const summaries = forkchoice.getAllAncestorBlocks(finalizedDesc);
    // there are 2 blocks in protoArray but iterateAncestorBlocks should only return non-finalized blocks
    expect(summaries.length).to.be.equals(1, "should not return the finalized block");
    expect(summaries[0]).to.be.deep.include(block, "the block summary is not correct");
  });
});
