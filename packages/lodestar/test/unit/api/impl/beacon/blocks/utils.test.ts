import {SinonStubbedInstance} from "sinon";
import {ForkChoice, IProtoBlock, ExecutionStatus} from "@chainsafe/lodestar-fork-choice";
import {resolveBlockId} from "../../../../../../src/api/impl/beacon/blocks/utils";
import {expect, use} from "chai";
import {toHexString} from "@chainsafe/ssz";
import {generateEmptySignedBlock, generateProtoBlock} from "../../../../../utils/block";
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
    let expectedRootHex: string;
    let expectedSummary: IProtoBlock;

    before(function () {
      expectedBuffer = Buffer.alloc(32, 2);
      expectedRootHex = toHexString(expectedBuffer);
      expectedSummary = {
        slot: 0,
        blockRoot: expectedRootHex,
        parentRoot: expectedRootHex,
        targetRoot: expectedRootHex,
        stateRoot: expectedRootHex,

        finalizedEpoch: 0,
        finalizedRoot: expectedRootHex,
        justifiedEpoch: 0,
        justifiedRoot: expectedRootHex,

        ...{executionPayloadBlockHash: null, executionStatus: ExecutionStatus.PreMerge},
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
    });

    it("should resolve genesis", async function () {
      await resolveBlockId(forkChoiceStub, dbStub, "genesis").catch(() => {});
      expect(dbStub.blockArchive.get.withArgs(GENESIS_SLOT).calledOnce).to.be.true;
    });

    it("should resolve finalized", async function () {
      const expected = 0;
      forkChoiceStub.getFinalizedBlock.returns(expectedSummary);
      await resolveBlockId(forkChoiceStub, dbStub, "finalized").catch(() => {});
      expect(dbStub.blockArchive.get.withArgs(expected).calledOnce).to.be.true;
    });

    it("should resolve finalized block root", async function () {
      forkChoiceStub.getBlock.returns(expectedSummary);
      forkChoiceStub.getFinalizedBlock.returns(expectedSummary);
      dbStub.blockArchive.getByRoot.withArgs(bufferEqualsMatcher(expectedBuffer)).resolves(null);
      await resolveBlockId(forkChoiceStub, dbStub, toHexString(expectedBuffer)).catch(() => {});
      expect(dbStub.blockArchive.get.withArgs(expectedSummary.slot).calledOnce).to.be.true;
    });

    it("should resolve non finalized block root", async function () {
      forkChoiceStub.getBlock.returns(null);
      dbStub.block.get.withArgs(bufferEqualsMatcher(expectedBuffer)).resolves(generateEmptySignedBlock());
      await resolveBlockId(forkChoiceStub, dbStub, toHexString(expectedBuffer)).catch(() => {});
      expect(dbStub.blockArchive.getByRoot.withArgs(bufferEqualsMatcher(expectedBuffer)).calledOnce).to.be.true;
    });

    it("should resolve non finalized slot", async function () {
      forkChoiceStub.getCanonicalBlockAtSlot.withArgs(2).returns({
        ...generateProtoBlock(),
        blockRoot: expectedRootHex,
      });
      await resolveBlockId(forkChoiceStub, dbStub, "2").catch(() => {});
      expect(forkChoiceStub.getCanonicalBlockAtSlot.withArgs(2).calledOnce).to.be.true;
    });

    it("should resolve finalized slot", async function () {
      forkChoiceStub.getCanonicalBlockAtSlot.withArgs(2).returns(null);
      await resolveBlockId(forkChoiceStub, dbStub, "2").catch(() => {});
      expect(forkChoiceStub.getCanonicalBlockAtSlot.withArgs(2).calledOnce).to.be.true;
      expect(dbStub.blockArchive.get.withArgs(2).calledOnce).to.be.true;
    });

    it("should trow on invalid", async function () {
      await expect(resolveBlockId(forkChoiceStub, dbStub, "asbc")).to.eventually.be.rejected;
    });
  });
});
