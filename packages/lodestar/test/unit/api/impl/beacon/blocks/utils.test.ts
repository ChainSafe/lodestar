import {SinonStubbedInstance} from "sinon";
import {ArrayDagLMDGHOST, ILMDGHOST} from "../../../../../../src/chain/forkChoice";
import sinon from "sinon";
import {resolveBlockId} from "../../../../../../src/api/impl/beacon/blocks/utils";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {expect, use} from "chai";
import {toHexString} from "@chainsafe/ssz";
import {generateEmptyBlockSummary} from "../../../../../utils/block";
import chaiAsPromised from "chai-as-promised";

use(chaiAsPromised);

describe("block api utils", function () {

  describe("resolveBlockId", function () {

    let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;

    beforeEach(function () {
      forkChoiceStub = sinon.createStubInstance(ArrayDagLMDGHOST);
    });

    it("should resolve head", async function () {
      const expected = Buffer.alloc(32, 2);
      forkChoiceStub.headBlockRoot.returns(expected);
      const root = await resolveBlockId(config, forkChoiceStub, "head");
      expect(root).to.be.equal(expected);
    });

    it.skip("should resolve genesis", async function () {
      const expected = Buffer.alloc(32, 2);
      const root = await resolveBlockId(config, forkChoiceStub, "genesis");
      expect(root).to.be.equal(expected);
    });

    it("should resolve finalized", async function () {
      const expected = Buffer.alloc(32, 2);
      forkChoiceStub.getFinalized.returns({epoch: 0, root: expected});
      const root = await resolveBlockId(config, forkChoiceStub, "finalized");
      expect(root).to.be.equal(expected);
    });

    it("should resolve root", async function () {
      const expected = Buffer.alloc(32, 2);
      const root = await resolveBlockId(config, forkChoiceStub, toHexString(expected));
      expect(root).to.be.deep.equal(expected);
    });

    it("should resolve non finalized slot", async function () {
      const expected = Buffer.alloc(32, 2);
      forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).returns({
        ...generateEmptyBlockSummary(),
        blockRoot: expected
      });
      const root = await resolveBlockId(config, forkChoiceStub, "2");
      expect(root).to.be.deep.equal(expected);
    });

    it.skip("should resolve finalized slot", async function () {
      const expected = Buffer.alloc(32, 2);
      forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).returns(null);
      const root = await resolveBlockId(config, forkChoiceStub, "2");
      expect(root).to.be.deep.equal(expected);
    });

    it("should trow on invalid", async function () {
      await expect(resolveBlockId(config, forkChoiceStub, "asbc")).to.eventually.be.rejected;
    });

  });

});
