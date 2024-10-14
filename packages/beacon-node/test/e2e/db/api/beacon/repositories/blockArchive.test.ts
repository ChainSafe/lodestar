import {beforeAll, afterAll, describe, it, expect} from "vitest";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {BeaconDb} from "../../../../../../src/db/index.js";
import {startTmpBeaconDb} from "../../../../../utils/db.js";

describe("BlockArchiveRepository", () => {
  let db: BeaconDb;
  const sampleBlock = ssz.phase0.SignedBeaconBlock.defaultValue();

  beforeAll(async () => {
    db = await startTmpBeaconDb(config);
  });

  afterAll(async () => {
    await db.close();
  });

  it("batchPutBinary should result in the same to batchPut", async () => {
    const signedBlock2 = ssz.phase0.SignedBeaconBlock.defaultValue();
    signedBlock2.message.slot = 3000;
    await db.blockArchive.batchPut([
      {
        key: sampleBlock.message.slot,
        value: sampleBlock,
      },
    ]);
    await db.blockArchive.batchPutBinary([
      {
        key: signedBlock2.message.slot,
        value: ssz.phase0.SignedBeaconBlock.serialize(signedBlock2) as Buffer,
        slot: signedBlock2.message.slot,
        blockRoot: config.getForkTypes(signedBlock2.message.slot).BeaconBlock.hashTreeRoot(signedBlock2.message),
        parentRoot: signedBlock2.message.parentRoot,
      },
    ]);
    const savedBlock1 = await db.blockArchive.get(sampleBlock.message.slot);
    const savedBlock2 = await db.blockArchive.get(signedBlock2.message.slot);

    if (!savedBlock1) throw Error("no savedBlock1");
    if (!savedBlock2) throw Error("no savedBlock2");

    // make sure they are the same except for slot
    savedBlock2.message.slot = sampleBlock.message.slot;
    expect(ssz.phase0.SignedBeaconBlock.equals(savedBlock1, savedBlock2)).toBe(true);
  });
});
