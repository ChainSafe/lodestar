import {SinonStubbedInstance} from "sinon";
import {ForkChoice, IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {resolveBlockId} from "../../../../../../src/api/impl/beacon/blocks/utils";
import {expect, use} from "chai";
import {toHexString} from "@chainsafe/ssz";
import {generateBlockSummary, generateEmptySignedBlock} from "../../../../../utils/block";
import chaiAsPromised from "chai-as-promised";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {GENESIS_SLOT} from "../../../../../../src/constants";
import {bufferEqualsMatcher} from "../../../../../utils/sinon/matcher";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test";

/* eslint-disable @typescript-eslint/no-empty-function */

use(chaiAsPromised);

describe("block api utils", function () {
  describe("resolveBlockId", function () {
    let forkChoiceStub: SinonStubbedInstance<ForkChoice>;
    let dbStub: StubbedBeaconDb;
    let server: ApiImplTestModules;
    let expectedBuffer: Buffer;
    let expectedSummary: IBlockSummary;

    before(function () {
      expectedBuffer = Buffer.alloc(32, 2);
      expectedSummary = {
        blockRoot: expectedBuffer,
        parentRoot: expectedBuffer,
        targetRoot: expectedBuffer,
        stateRoot: expectedBuffer,
        finalizedEpoch: 0,
        justifiedEpoch: 0,
        slot: 0,
      };
    });

    beforeEach(function () {
      server = setupApiImplTestServer();
      forkChoiceStub = server.forkChoiceStub;
      dbStub = server.dbStub;
    });

    it("should resolve head", async function () {
      forkChoiceStub.getHead.returns(expectedSummary);
      await resolveBlockId(forkChoiceStub, dbStub, "head").catch(() => {});
      expect(dbStub.block.get.withArgs(expectedBuffer).calledOnce).to.be.true;
    });

    it("should resolve genesis", async function () {
      await resolveBlockId(forkChoiceStub, dbStub, "genesis").catch(() => {});
      expect(dbStub.blockArchive.get.withArgs(GENESIS_SLOT).calledOnce).to.be.true;
    });

    it("should resolve finalized", async function () {
      const expected = 0;
      forkChoiceStub.getFinalizedCheckpoint.returns({epoch: expected, root: Buffer.alloc(32, 2)});
      await resolveBlockId(forkChoiceStub, dbStub, "finalized").catch(() => {});
      expect(dbStub.blockArchive.get.withArgs(expected).calledOnce).to.be.true;
    });

    it("should resolve finalized block root", async function () {
      forkChoiceStub.getBlock.returns(expectedSummary);
      dbStub.block.get.withArgs(bufferEqualsMatcher(expectedBuffer)).resolves(null);
      await resolveBlockId(forkChoiceStub, dbStub, toHexString(expectedBuffer)).catch(() => {});
      expect(dbStub.block.get.withArgs(bufferEqualsMatcher(expectedBuffer)).calledOnce).to.be.true;
    });

    it("should resolve non finalized block root", async function () {
      forkChoiceStub.getBlock.returns(null);
      dbStub.block.get.withArgs(bufferEqualsMatcher(expectedBuffer)).resolves(generateEmptySignedBlock());
      await resolveBlockId(forkChoiceStub, dbStub, toHexString(expectedBuffer)).catch(() => {});
      expect(dbStub.blockArchive.getByRoot.withArgs(bufferEqualsMatcher(expectedBuffer)).calledOnce).to.be.true;
    });

    it("should resolve non finalized slot", async function () {
      forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).returns({
        ...generateBlockSummary(),
        blockRoot: expectedBuffer,
      });
      await resolveBlockId(forkChoiceStub, dbStub, "2").catch(() => {});
      expect(forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).calledOnce).to.be.true;
    });

    it("should resolve finalized slot", async function () {
      forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).returns(null);
      await resolveBlockId(forkChoiceStub, dbStub, "2").catch(() => {});
      expect(forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(2).calledOnce).to.be.true;
      expect(dbStub.blockArchive.get.withArgs(2).calledOnce).to.be.true;
    });

    it("should trow on invalid", async function () {
      await expect(resolveBlockId(forkChoiceStub, dbStub, "asbc")).to.eventually.be.rejected;
    });
  });
});
