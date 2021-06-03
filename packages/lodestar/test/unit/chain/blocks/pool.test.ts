import {config} from "@chainsafe/lodestar-config/default";
import {ssz} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {BlockPool} from "../../../../src/chain/blocks";

describe("BlockPool", function () {
  let pool: BlockPool;

  beforeEach(() => {
    pool = new BlockPool({config});
  });

  it("should get missing ancestor", () => {
    const firstBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    const ancestorRoot = firstBlock.message.parentRoot;
    const secondBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    secondBlock.message.parentRoot = ssz.phase0.BeaconBlock.hashTreeRoot(firstBlock.message);
    pool.addBySlot(firstBlock);
    pool.addByParent(secondBlock);
    const root = pool.getMissingAncestor(ssz.phase0.BeaconBlock.hashTreeRoot(secondBlock.message));
    expect(ssz.Root.equals(ancestorRoot, root)).to.be.true;
  });
});
