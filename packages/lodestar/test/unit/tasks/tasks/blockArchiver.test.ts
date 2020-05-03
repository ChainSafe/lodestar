import {describe, it, beforeEach} from "mocha";
import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";

import {ArchiveBlocksTask} from "../../../../src/tasks/tasks/archiveBlocks";
import {generateEmptyBlock, generateEmptySignedBlock} from "../../../utils/block";
import {StubbedBeaconDb} from "../../../utils/stub";

describe("block archiver task", function () {

  const sandbox = sinon.createSandbox();

  let dbStub: StubbedBeaconDb, loggerStub: any;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sandbox);
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
    dbStub.block.values.resolves([
      generateEmptySignedBlock(),
      generateEmptySignedBlock(),
      {
        message: {
          ...generateEmptyBlock(),
          slot: computeStartSlotAtEpoch(config, 4)
        },
        signature: Buffer.alloc(96),
      },
    ]);
    await archiverTask.run();
    expect(
      dbStub.blockArchive.batchAdd.calledOnceWith(sinon.match((criteria) => criteria.length === 2))
    ).to.be.true;
    expect(
      dbStub.block.batchRemove.calledOnceWith(sinon.match((criteria) => criteria.length === 2))
    ).to.be.true;
  });

});
