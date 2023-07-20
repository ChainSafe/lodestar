// import {expect} from "chai";
// import {rimraf} from "rimraf";
// import sinon from "sinon";
// import {ssz} from "@lodestar/types";
// import {config} from "@lodestar/config/default";
// import {LevelDbController} from "@lodestar/db";
// import {testLogger} from "../../../../utils/logger.js";
// import {BlockArchiveRepository} from "../../../../../src/db/repositories/index.js";

// describe("block archive repository", () => {
//   const testDir = "./.tmp";
//   let blockArchive: BlockArchiveRepository;
//   let db: LevelDbController;

//   beforeEach(async function () {
//     db = await LevelDbController.create({name: testDir}, {logger: testLogger()});
//     blockArchive = new BlockArchiveRepository(config, db);
//   });
//   afterEach(async function () {
//     await db.close();
//     rimraf.sync(testDir);
//   });

//   describe("put", () => {
//     it("should handle blinded blocks", () => {});

//     it("should handle full blocks", () => {});
//   });

//   describe("batchPut", () => {
//     it("should handle blinded blocks", () => {});

//     it("should handle full blocks", () => {});
//   });

//   describe("putBinary", () => {
//     it("should handle blinded blocks", () => {});

//     it("should handle full blocks", () => {});
//   });

//   describe("putFullBinary", () => {
//     it("should putFullBinary as blinded", () => {});
//   });

//   describe("batchPutBinary", () => {
//     it("should handle blinded blocks", () => {});

//     it("should handle full blocks", () => {});
//   });

//   describe("get", () => {
//     it("should return null for missing blocks", () => {});

//     it("should return blinded for blocks put as blinded", () => {});

//     it("should return full blocks for blocks put as full", () => {});
//   });

//   describe("getFull", () => {});

//   describe("getBinary", () => {});

//   describe("getFullBinary", () => {});
// });
