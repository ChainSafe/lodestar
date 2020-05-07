import {LevelDbController} from "../../../src/db/controller";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import sinon from "sinon";
// @ts-ignore
import leveldown from "leveldown";
import {promisify} from "es6-promisify";
import {BlockArchiveRepository} from "../../../src/db/api/beacon/repositories";
import {config} from "@chainsafe/lodestar-config/src/presets/minimal";
import {SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {generateEmptySignedBlock} from "../../utils/block";
import {mkdirSync} from "fs";
import {expect} from "chai";

describe("block archive", function () {

  const dbLocation = "./.__testdb";

  let dbController: LevelDbController, blockArchive: BlockArchiveRepository;

  beforeEach(async function () {
    dbController = new LevelDbController(
      {name: dbLocation},
      {logger: sinon.createStubInstance(WinstonLogger)}
    );
    blockArchive = new BlockArchiveRepository(config, dbController);
    mkdirSync(dbLocation, {recursive: true});
    await dbController.start();
    await Promise.all(generateBlocks().map((block) => {
      return blockArchive.put(block.message.slot, block);
    }));
  });

  afterEach(async function () {
    await dbController.stop();
    await promisify<void, string>(leveldown.destroy)(dbLocation);
  });

  it("should search for block range", async function () {
    const filteredBlocks = await blockArchive.values({
      gte: 2,
      lt: 4
    });
    expect(filteredBlocks.length).to.be.equal(2);
    expect(filteredBlocks[0].message.slot).to.be.equal(2);
    expect(filteredBlocks[1].message.slot).to.be.equal(3);
  });

  function generateBlocks(): SignedBeaconBlock[] {
    return Array.from({length: 5}, (value: null, slot: Slot) => {
      const block = generateEmptySignedBlock();
      block.message.slot = slot;
      return block;
    });
  }

});
