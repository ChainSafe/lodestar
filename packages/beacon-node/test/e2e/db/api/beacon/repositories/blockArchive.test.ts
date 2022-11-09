import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {fromHexString} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {BeaconDb} from "../../../../../../src/db/index.js";
import {generateSignedBlock} from "../../../../../utils/block.js";
import {startTmpBeaconDb} from "../../../../../utils/db.js";

describe("BlockArchiveRepository", function () {
  let db: BeaconDb;
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
    db = await startTmpBeaconDb(config);
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
    expect(ssz.phase0.SignedBeaconBlock.equals(savedBlock1, savedBlock2)).to.equal(true);
  });
});
