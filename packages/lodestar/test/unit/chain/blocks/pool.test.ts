import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {expect} from "chai";
import {BlockPool} from "../../../../src/chain/blocks";
import {IBlockJob} from "../../../../src/chain";

describe("BlockPool", function () {
  let pool: BlockPool;

  beforeEach(() => {
    pool = new BlockPool({config});
  });

  it("should get missing ancestor", () => {
    const firstBlock = config.types.SignedBeaconBlock.defaultValue();
    const ancestorRoot = firstBlock.message.parentRoot;
    const secondBlock = config.types.SignedBeaconBlock.defaultValue();
    secondBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(firstBlock.message);
    const jobs: IBlockJob[] = [firstBlock, secondBlock].map((block) => ({
      signedBlock: block,
      trusted: false,
      reprocess: false,
    }));
    pool.addBySlot(jobs[0]);
    pool.addByParent(jobs[1]);
    const root = pool.getMissingAncestor(config.types.BeaconBlock.hashTreeRoot(secondBlock.message));
    expect(config.types.Root.equals(ancestorRoot, root)).to.be.true;
  });
});
