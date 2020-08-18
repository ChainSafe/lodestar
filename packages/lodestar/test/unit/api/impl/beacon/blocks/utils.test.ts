import sinon, {SinonStubbedInstance} from "sinon";
import {ArrayDagLMDGHOST, ILMDGHOST} from "../../../../../../src/chain/forkChoice";
import {resolveBlockId} from "../../../../../../src/api/impl/beacon/blocks/utils";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {expect, use} from "chai";
import {toHexString} from "@chainsafe/ssz";
import {generateEmptyBlockSummary, generateEmptySignedBlock} from "../../../../../utils/block";
import chaiAsPromised from "chai-as-promised";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {GENESIS_SLOT} from "../../../../../../src/constants";
import {bufferEqualsMatcher} from "../../../../../utils/sinon/matcher";

use(chaiAsPromised);

describe("block api utils", function () {

  describe("resolveBlockId", function () {

    let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;

    let dbStub: StubbedBeaconDb;

    beforeEach(function () {
      forkChoiceStub = sinon.createStubInstance(ArrayDagLMDGHOST);
      dbStub = new StubbedBeaconDb(sinon, config);
    });

    it("should resolve head", async function () {
      const expected = Buffer.alloc(32, 2);
      forkChoiceStub.headBlockRoot.returns(expected);
      await resolveBlockId(config, forkChoiceStub, dbStub, "head");
      expect(dbStub.block.get.withArgs(expected).calledOnce).to.be.true;
    });

    it("should resolve genesis", async function () {
      await resolveBlockId(config, forkChoiceStub, dbStub, "genesis");
      expect(dbStub.blockArchive.get.withArgs(GENESIS_SLOT).calledOnce).to.be.true;
    });

    it("should resolve finalized", async function () {
      const expected = Buffer.alloc(32, 2);
      forkChoiceStub.getFinalized.returns({epoch: 0, root: expected});
      await resolveBlockId(config, forkChoiceStub, dbStub, "finalized");
      expect(dbStub.block.get.withArgs(expected).calledOnce).to.be.true;
    });

    it("should resolve finalized block root", async function () {
      const expected = Buffer.alloc(32, 2);
      dbStub.block.get.withArgs(bufferEqualsMatcher(expected)).resolves(null);
      await resolveBlockId(config, forkChoiceStub, dbStub, toHexString(expected));
      expect(dbStub.block.get.withArgs(bufferEqualsMatcher(expected)).calledOnce).to.be.true;
      expect(dbStub.blockArchive.getByRoot.withArgs(bufferEqualsMatcher(expected)).calledOnce).to.be.true;
    });

    it("should resolve non finalized block root", async function () {
      const expected = Buffer.alloc(32, 2);
      dbStub.block.get.withArgs(bufferEqualsMatcher(expected)).resolves(generateEmptySignedBlock());
      await resolveBlockId(config, forkChoiceStub, dbStub, toHexString(expected));
      expect(dbStub.block.get.withArgs(bufferEqualsMatcher(expected)).calledOnce).to.be.true;
      expect(dbStub.blockArchive.getByRoot.withArgs(bufferEqualsMatcher(expected)).notCalled).to.be.true;
    });

    it("should resolve non finalized slot", async function () {
      const expected = Buffer.alloc(32, 2);
      forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).returns({
        ...generateEmptyBlockSummary(),
        blockRoot: expected
      });
      await resolveBlockId(config, forkChoiceStub, dbStub, "2");
      expect(forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).calledOnce).to.be.true;
    });

    it("should resolve finalized slot", async function () {
      forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).returns(null);
      await resolveBlockId(config, forkChoiceStub, dbStub, "2");
      expect(forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).calledOnce).to.be.true;
      expect(dbStub.blockArchive.get.withArgs(2).calledOnce).to.be.true;
    });

    it("should trow on invalid", async function () {
      await expect(resolveBlockId(config, forkChoiceStub, dbStub, "asbc")).to.eventually.be.rejected;
    });

  });

});
