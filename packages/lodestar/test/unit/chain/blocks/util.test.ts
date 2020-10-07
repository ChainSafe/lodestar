import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

import {findUnknownAncestor} from "../../../../src/chain/blocks/util";
import {IBlockJob} from "../../../../src/chain";

describe("findUnknownAncestor", function () {
  it("should return same root if not found", () => {
    const root = Buffer.alloc(32, 1);
    expect(findUnknownAncestor(config, [], root)).to.be.deep.equal(root);
    expect(
      findUnknownAncestor(
        config,
        [
          {
            signedBlock: config.types.SignedBeaconBlock.defaultValue(),
            trusted: false,
            reprocess: false,
          },
        ],
        root
      )
    ).to.be.deep.equal(root);
  });

  it("should return ancestor root", function () {
    const firstBlock = config.types.SignedBeaconBlock.defaultValue();
    const ancestorRoot = firstBlock.message.parentRoot;
    const secondBlock = config.types.SignedBeaconBlock.defaultValue();
    secondBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(firstBlock.message);
    const jobs: IBlockJob[] = [firstBlock, secondBlock].map((block) => ({
      signedBlock: block,
      trusted: false,
      reprocess: false,
    }));
    const root = findUnknownAncestor(config, jobs, secondBlock.message.parentRoot);
    expect(config.types.Root.equals(ancestorRoot, root)).to.be.true;
  });
});
