import {config} from "@chainsafe/lodestar-config/default";
import {ssz} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {BlockPool} from "../../../../src/chain/blocks";
import {testLogger} from "../../../utils/logger";

describe("BlockPool", function () {
  const logger = testLogger();
  let pool: BlockPool;

  beforeEach(() => {
    pool = new BlockPool(config, logger);
  });

  it("should get missing ancestor", () => {
    const firstBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    const ancestorRoot = firstBlock.message.parentRoot;
    const secondBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    secondBlock.message.parentRoot = ssz.phase0.BeaconBlock.hashTreeRoot(firstBlock.message);
    pool.addByParent(firstBlock);
    pool.addByParent(secondBlock);
    const root = pool.getMissingAncestor(ssz.phase0.BeaconBlock.hashTreeRoot(secondBlock.message));
    expect(ssz.Root.equals(ancestorRoot, root)).to.be.true;
  });
});
