import {describe, it, beforeEach} from "mocha";
import sinon from "sinon";
import {BlockRepository} from "../../../../src/db/api/beacon/repositories";
import {BlockArchiveRepository} from "../../../../src/db/api/beacon/repositories/blockArchive";
import {WinstonLogger} from "../../../../src/logger";
import {ArchiveBlocksTask} from "../../../../src/tasks/tasks/archiveBlocks";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {expect} from "chai";
import {generateEmptyBlock} from "../../../utils/block";
import {computeStartSlotOfEpoch} from "@chainsafe/eth2.0-state-transition";

describe("block archiver task", function () {

  const sandbox = sinon.createSandbox();

  let dbStub: any, loggerStub: any;

  beforeEach(function () {
    dbStub = {
      block: sandbox.createStubInstance(BlockRepository),
      blockArchive: sandbox.createStubInstance(BlockArchiveRepository)
    };
    loggerStub = sandbox.createStubInstance(WinstonLogger);
  });

  it("should archive finalized blocks", async function () {
    const archiverTask = new ArchiveBlocksTask(
      config,
      {
        db: dbStub,
        logger: loggerStub
      }, {
        epoch: 3,
        root: Buffer.alloc(32)
      }
    );
    dbStub.block.getAll.resolves([
      generateEmptyBlock(),
      generateEmptyBlock(),
      {
        ...generateEmptyBlock(),
        slot: computeStartSlotOfEpoch(config, 4)
      }
    ]);
    await archiverTask.run();
    expect(
      dbStub.blockArchive.addMany.calledOnceWith(sinon.match((criteria) => criteria.length === 2))
    ).to.be.true;
    expect(
      dbStub.block.deleteManyByValue.calledOnceWith(sinon.match((criteria) => criteria.length === 2))
    ).to.be.true;
  });

});