import {SinonStubbedInstance} from "sinon";
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
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test";

use(chaiAsPromised);

describe("block api utils", function () {
  describe("resolveBlockId", function () {
    let forkChoiceStub: SinonStubbedInstance<ForkChoice>;
    let dbStub: StubbedBeaconDb;
    let server: ApiImplTestModules;
    let expectedBuffer: Buffer;

    before(function () {
      expectedBuffer = Buffer.alloc(32, 2);
    });

    beforeEach(function () {
      server = setupApiImplTestServer();
      forkChoiceStub = server.forkChoiceStub;
      dbStub = server.dbStub;
    });

    it("should resolve head", async function () {
      forkChoiceStub.getHeadRoot.returns(expectedBuffer);
      await resolveBlockId(config, forkChoiceStub, dbStub, "head");
      expect(dbStub.block.get.withArgs(expectedBuffer).calledOnce).to.be.true;
    });

    it("should resolve genesis", async function () {
      await resolveBlockId(config, forkChoiceStub, dbStub, "genesis");
      expect(dbStub.blockArchive.get.withArgs(GENESIS_SLOT).calledOnce).to.be.true;
    });

    it("should resolve finalized", async function () {
      const expected = 0;
      forkChoiceStub.getFinalizedCheckpoint.returns({epoch: expected, root: Buffer.alloc(32, 2)});
      await resolveBlockId(config, forkChoiceStub, dbStub, "finalized");
      expect(dbStub.blockArchive.get.withArgs(expected).calledOnce).to.be.true;
    });

    it("should resolve finalized block root", async function () {
      dbStub.block.get.withArgs(bufferEqualsMatcher(expectedBuffer)).resolves(null);
      await resolveBlockId(config, forkChoiceStub, dbStub, toHexString(expectedBuffer));
      expect(dbStub.block.get.withArgs(bufferEqualsMatcher(expectedBuffer)).calledOnce).to.be.true;
      expect(dbStub.blockArchive.getByRoot.withArgs(bufferEqualsMatcher(expectedBuffer)).calledOnce).to.be.true;
    });

    it("should resolve non finalized block root", async function () {
      dbStub.block.get.withArgs(bufferEqualsMatcher(expectedBuffer)).resolves(generateEmptySignedBlock());
      await resolveBlockId(config, forkChoiceStub, dbStub, toHexString(expectedBuffer));
      expect(dbStub.block.get.withArgs(bufferEqualsMatcher(expectedBuffer)).calledOnce).to.be.true;
      expect(dbStub.blockArchive.getByRoot.withArgs(bufferEqualsMatcher(expectedBuffer)).notCalled).to.be.true;
    });

    it("should resolve non finalized slot", async function () {
      forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).returns({
        ...generateBlockSummary(),
        blockRoot: expectedBuffer,
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
