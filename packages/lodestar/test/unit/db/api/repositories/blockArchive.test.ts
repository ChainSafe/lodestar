import {beforeEach, describe, it} from "mocha";
import {expect} from "chai";
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
    let lastSlot = 0;
    for await (const slot of blockArchive.keysStream()) {
      expect(slot).to.be.gt(lastSlot);
      lastSlot = slot;
    }

    // test values
    lastSlot = 0;
    for await (const block of blockArchive.valuesStream()) {
      expect(block.message.slot).to.be.gt(lastSlot);
      lastSlot = block.message.slot;
    }

    let blocks;
    // test gte, lte
    blocks = await blockArchive.values({gte: 2, lte: 5});
    expect(blocks.length).to.be.equal(4);
    expect(blocks[0].message.slot).to.be.equal(2);
    expect(blocks[3].message.slot).to.be.equal(5);
    lastSlot = 0;
    for (const block of blocks) {
      expect(block.message.slot).to.be.gt(lastSlot);
      lastSlot = block.message.slot;
    }

    // test gt, lt
    blocks = await blockArchive.values({gt: 2, lt: 6});
    expect(blocks.length).to.be.equal(3);
    expect(blocks[0].message.slot).to.be.equal(3);
    expect(blocks[2].message.slot).to.be.equal(5);
    lastSlot = 0;
    for (const block of blocks) {
      expect(block.message.slot).to.be.gt(lastSlot);
      lastSlot = block.message.slot;
    }

    // test across byte boundaries
    blocks = await blockArchive.values({gte: 200, lt: 400});
    expect(blocks.length).to.be.equal(200);
    expect(blocks[0].message.slot).to.be.equal(200);
    expect(blocks[199].message.slot).to.be.equal(399);
    lastSlot = 0;
    for (const block of blocks) {
      expect(block.message.slot).to.be.gt(lastSlot);
      lastSlot = block.message.slot;
    }

    // test gt until end
    blocks = await blockArchive.values({gt: 700});
    expect(blocks.length).to.be.equal(300);
    expect(blocks[0].message.slot).to.be.equal(701);
    expect(blocks[299].message.slot).to.be.equal(1000);
    lastSlot = 0;
    for (const block of blocks) {
      expect(block.message.slot).to.be.gt(lastSlot);
      lastSlot = block.message.slot;
    }

    // test beginning until lt
    blocks = await blockArchive.values({lte: 200});
    expect(blocks.length).to.be.equal(200);
    expect(blocks[0].message.slot).to.be.equal(1);
    expect(blocks[199].message.slot).to.be.equal(200);
    lastSlot = 0;
    for (const block of blocks) {
      expect(block.message.slot).to.be.gt(lastSlot);
      lastSlot = block.message.slot;
    }
  });
});
