import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import {BlockPool} from "../../../../src/chain/blocks";

describe("BlockPool", function () {
  let pool: BlockPool;

  beforeEach(() => {
    pool = new BlockPool({config});
  });

  it("should get missing ancestor", () => {
    const firstBlock = config.types.phase0.SignedBeaconBlock.defaultValue();
    const ancestorRoot = firstBlock.message.parentRoot;
    const secondBlock = config.types.phase0.SignedBeaconBlock.defaultValue();
    secondBlock.message.parentRoot = config.types.phase0.BeaconBlock.hashTreeRoot(firstBlock.message);
    pool.addBySlot(firstBlock);
    pool.addByParent(secondBlock);
    const root = pool.getMissingAncestor(config.types.phase0.BeaconBlock.hashTreeRoot(secondBlock.message));
    expect(config.types.Root.equals(ancestorRoot, root)).to.be.true;
  });
});
