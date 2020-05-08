import {beforeEach, describe, it} from "mocha";
import {expect} from "chai";
import sinon from "sinon";
import rimraf from "rimraf";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {WinstonLogger} from "@chainsafe/lodestar-utils";

import {LevelDbController} from "../../../../../src/db/controller";
import {generateEmptySignedBlock} from "../../../../utils/block";
import {BlockArchiveRepository} from "../../../../../src/db/api/beacon/repositories";

describe("block archive repository", function () {

  const logger = new WinstonLogger();
  logger.silent = true;
  const testDir = "./.tmp";
  let blockArchive: BlockArchiveRepository;
  let controller: LevelDbController;

  beforeEach(async function () {
    controller = new LevelDbController({name: testDir}, {logger});
    blockArchive = new BlockArchiveRepository(
      config,
      controller,
    );
    await controller.start();
  });
  afterEach(async function () {
    await controller.stop();
    rimraf.sync(testDir);
  });

  it("should retrieve blocks in order", async function () {
    await blockArchive.batchPut(Array.from({length: 1000}, (_, i) => {
      const slot = i + 1;
      const block = generateEmptySignedBlock();
      block.message.slot = slot;
      return {
        key: slot,
        value: block,
      };
    }));
    // test keys
    const slots = blockArchive.keysStream();
    let lastSlot = 0;
    for await (const slot of slots) {
      expect(slot).to.be.gt(lastSlot);
      lastSlot = slot;
    }

    // test values
    lastSlot = 0;
    const blocks = blockArchive.valuesStream();
    for await (const block of blocks) {
      expect(block.message.slot).to.be.gt(lastSlot);
      lastSlot = block.message.slot;
    }
  });
});
