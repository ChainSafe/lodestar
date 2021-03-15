import {BeaconDb} from "../../../../../../src/db";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {generateSignedBlock} from "../../../../../utils/block";
import {testLogger} from "../../../../../utils/logger";
import {fromHexString} from "@chainsafe/ssz";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {phase0} from "@chainsafe/lodestar-types";
import {expect} from "chai";

describe("BlockArchiveRepository", function () {
  let db: BeaconDb;
  const logger = testLogger();
  const sampleBlock = generateSignedBlock({
    message: {
      slot: 0,
      proposerIndex: 10,
      parentRoot: fromHexString("0x954393e06c401df786b28346ad0c3d6f3c78753dd7ad5ee10a5a377686a89345"),
      stateRoot: fromHexString("0x1871966eb57a657b0e876b44f968d9cfd0ee8a150499306c5528c16972e4cae2"),
      body: {
        randaoReveal: fromHexString(
          "0xa1d36b62feaa026b95897cfad8b2b57dd2de41a339f91a792b4d1ce8c22c57093e7c51d683ccbf899861d0b18f15fc6f03e1434f8d4dba48bc7b08c0ef69cf538a74addf50544e5a7eac558806a2e754a4c240a04ceadac787fa6cf729fe307e"
        ),
        graffiti: fromHexString("0x6775696c647761727a2d616c7561747500000000000000000000000000000000"),
        eth1Data: {
          blockHash: Buffer.alloc(32, 1),
          depositRoot: Buffer.alloc(32, 1),
          depositCount: 100,
        },
      },
    },
    signature: fromHexString(
      "0xa11dd7547cfda02799745e305ec149d8a90d3ff12cac5a9cb60b0e07bb7e1b06117b0055822099b78422c982cc2f5148023a3fe61a7505f08857b9d30f675600e404f4993ecc4ef75d657e6c84e859aefcd458fb544fb2caa773e916297d6124"
    ),
  });

  before(async () => {
    db = new BeaconDb({
      config,
      controller: new LevelDbController({name: ".tmpdb"}, {logger}),
    });
    await db.start();
  });

  after(async () => {
    await db.stop();
  });

  it("batchPutBinary should result in the same to batchPut", async () => {
    const signedBlock2 = sampleBlock;
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
        value: config.types.phase0.SignedBeaconBlock.serialize(signedBlock2) as Buffer,
        summary: toBlockSummary(signedBlock2),
      },
    ]);
    const savedBlock1 = await db.blockArchive.get(sampleBlock.message.slot);
    const savedBlock2 = await db.blockArchive.get(signedBlock2.message.slot);

    if (!savedBlock1) throw Error("no savedBlock1");
    if (!savedBlock2) throw Error("no savedBlock2");

    // make sure they are the same except for slot
    savedBlock2.message.slot = sampleBlock.message.slot;
    expect(config.types.phase0.SignedBeaconBlock.equals(savedBlock1, savedBlock2)).to.be.true;
  });

  it("batchPutBinary should be faster than batchPut", async () => {
    // increase length to test performance
    const signedBlocks = Array.from({length: 1000}, (_, i) => {
      const signedBlock = sampleBlock;
      signedBlock.message.slot = i;
      return signedBlock;
    });
    // persist to block db
    await Promise.all(signedBlocks.map((signedBlock: phase0.SignedBeaconBlock) => db.block.add(signedBlock)));
    const blockSummaries = signedBlocks.map(toBlockSummary);
    // old way
    logger.profile("batchPut");
    const savedBlocks = notNull(await Promise.all(blockSummaries.map((summary) => db.block.get(summary.blockRoot))));
    await db.blockArchive.batchPut(savedBlocks.map((block) => ({key: block.message.slot, value: block})));
    logger.profile("batchPut");
    logger.profile("batchPutBinary");
    const blockBinaries = notNull(
      await Promise.all(blockSummaries.map((summary) => db.block.getBinary(summary.blockRoot)))
    );
    await db.blockArchive.batchPutBinary(
      blockSummaries.map((summary, i) => ({
        key: summary.slot,
        value: blockBinaries[i],
        summary: summary,
      }))
    );
    logger.profile("batchPutBinary");
  });
});

function notNull<T>(arr: (T | null)[]): T[] {
  for (const item of arr) if (item === null) throw Error("null item");
  return arr as T[];
}

const toBlockSummary = (signedBlock: phase0.SignedBeaconBlock): IBlockSummary => {
  return {
    blockRoot: config.types.phase0.BeaconBlock.hashTreeRoot(signedBlock.message),
    finalizedEpoch: 0,
    justifiedEpoch: 0,
    parentRoot: signedBlock.message.parentRoot as Uint8Array,
    slot: signedBlock.message.slot,
    stateRoot: signedBlock.message.stateRoot as Uint8Array,
    targetRoot: Buffer.alloc(32),
  };
};
