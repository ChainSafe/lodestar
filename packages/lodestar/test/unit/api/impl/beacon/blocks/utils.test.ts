import sinon, {SinonStubbedInstance} from "sinon";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {resolveBlockId} from "../../../../../../src/api/impl/beacon/blocks/utils";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect, use} from "chai";
import {toHexString} from "@chainsafe/ssz";
import {generateBlockSummary, generateEmptySignedBlock} from "../../../../../utils/block";
import chaiAsPromised from "chai-as-promised";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {GENESIS_SLOT} from "../../../../../../src/constants";
import {bufferEqualsMatcher} from "../../../../../utils/sinon/matcher";

use(chaiAsPromised);

describe("utils tests", () => {
  describe("resolveBlockId", function () {
    let localForkChoiceStub: SinonStubbedInstance<ForkChoice>;
    let localDbStub: StubbedBeaconDb;

    beforeEach(function () {
      localForkChoiceStub = sinon.createStubInstance(ForkChoice);
      localDbStub = new StubbedBeaconDb(sinon, config);
    });

    it("should resolve head", async function () {
      const expected = Buffer.alloc(32, 2);
      localForkChoiceStub.getHeadRoot.returns(expected);
      await resolveBlockId(config, localForkChoiceStub, localDbStub, "head");
      expect(localDbStub.block.get.withArgs(expected).calledOnce).to.be.true;
    });

    it("should resolve genesis", async function () {
      await resolveBlockId(config, localForkChoiceStub, localDbStub, "genesis");
      expect(localDbStub.blockArchive.get.withArgs(GENESIS_SLOT).calledOnce).to.be.true;
    });

    it("should resolve finalized", async function () {
      const expected = Buffer.alloc(32, 2);
      localForkChoiceStub.getFinalizedCheckpoint.returns({epoch: 0, root: expected});
      await resolveBlockId(config, localForkChoiceStub, localDbStub, "finalized");
      expect(localDbStub.block.get.withArgs(expected).calledOnce).to.be.true;
    });

    it("should resolve finalized block root", async function () {
      const expected = Buffer.alloc(32, 2);
      localDbStub.block.get.withArgs(bufferEqualsMatcher(expected)).resolves(null);
      await resolveBlockId(config, localForkChoiceStub, localDbStub, toHexString(expected));
      expect(localDbStub.block.get.withArgs(bufferEqualsMatcher(expected)).calledOnce).to.be.true;
      expect(localDbStub.blockArchive.getByRoot.withArgs(bufferEqualsMatcher(expected)).calledOnce).to.be.true;
    });

    it("should resolve non finalized block root", async function () {
      const expected = Buffer.alloc(32, 2);
      localDbStub.block.get.withArgs(bufferEqualsMatcher(expected)).resolves(generateEmptySignedBlock());
      await resolveBlockId(config, localForkChoiceStub, localDbStub, toHexString(expected));
      expect(localDbStub.block.get.withArgs(bufferEqualsMatcher(expected)).calledOnce).to.be.true;
      expect(localDbStub.blockArchive.getByRoot.withArgs(bufferEqualsMatcher(expected)).notCalled).to.be.true;
    });

    it("should resolve non finalized slot", async function () {
      const expected = Buffer.alloc(32, 2);
      localForkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).returns({
        ...generateBlockSummary(),
        blockRoot: expected,
      });
      await resolveBlockId(config, localForkChoiceStub, localDbStub, "2");
      expect(localForkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).calledOnce).to.be.true;
    });

    it("should resolve finalized slot", async function () {
      localForkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).returns(null);
      await resolveBlockId(config, localForkChoiceStub, localDbStub, "2");
      expect(localForkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).calledOnce).to.be.true;
      expect(localDbStub.blockArchive.get.withArgs(2).calledOnce).to.be.true;
    });

    it("should trow on invalid", async function () {
      await expect(resolveBlockId(config, localForkChoiceStub, localDbStub, "asbc")).to.eventually.be.rejected;
    });
  });
});
