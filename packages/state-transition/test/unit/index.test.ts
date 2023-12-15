
import crypto from "crypto";
import {toHexString} from "@chainsafe/ssz";
import { MAX_BYTES_PER_TRANSACTION } from "@lodestar/params";
import { capella, ssz } from "@lodestar/types";
import {expect} from "chai";
import fs from "node:fs";
describe("Reproduce invalid state root", function () {
  this.timeout(0);
  // 2023-11-30 20:10:48.935
  // Nov-30 13:10:48.935[api]           verbose: Produced execution block slot=7877152, executionPayloadValue=24821199025607854, root=0x59625c9f56ea94f4eb445c92393dbbd52b506cfbdfc795438c0179873f4aae64
  it("test", () => {
    console.log("@@@ heello");
    const blockBytes = fs.readFileSync("/Users/tuyennguyen/tuyen/SignedBeaconBlock_0x6431c6cd2408d9e3182313ffc2482962feeec3946a7a77ed369b5b197f814371.ssz");
    console.log("@@@ loaded blockBytes: ", blockBytes.length);
    const signedBeaconBlock = ssz.capella.SignedBeaconBlock.deserializeToViewDU(blockBytes);
    console.log("@@@ deserialized signedBeaconBlock: ", signedBeaconBlock.message.slot);
    expect(signedBeaconBlock.message.slot).to.be.equal(7877152);
    // Nov-30 13:10:48.423[chain]         verbose: Produced beacon block body fork=capella, blockType=Full, slot=7877152, attestations=124,
    // deposits=0, voluntaryExits=0, attesterSlashings=0, proposerSlashings=0, feeRecipientType=requested,
    // feeRecipient=0x388c818ca8b9251b393131c08a736a67ccb19297, executionPayloadPrepType=Reorged, transactions=165,
    // blsToExecutionChanges=0, withdrawals=16, executionPayloadValue=24821199025607854
    expect(signedBeaconBlock.message.body.attestations.length).to.be.equal(124);
    expect(signedBeaconBlock.message.body.deposits.length).to.be.equal(0);
    expect(signedBeaconBlock.message.body.voluntaryExits.length).to.be.equal(0);
    expect(signedBeaconBlock.message.body.attesterSlashings.length).to.be.equal(0);
    expect(signedBeaconBlock.message.body.proposerSlashings.length).to.be.equal(0);
    expect(toHexString(signedBeaconBlock.message.body.executionPayload.feeRecipient)).to.be.equal("0x388c818ca8b9251b393131c08a736a67ccb19297");
    expect(signedBeaconBlock.message.body.executionPayload.transactions.length).to.be.equal(165);
    expect(signedBeaconBlock.message.body.executionPayload.withdrawals.length).to.be.equal(16);
    expect(signedBeaconBlock.message.body.blsToExecutionChanges.length).to.be.equal(0);
    // Failed
    const root = signedBeaconBlock.message.hashTreeRoot();
    const rootHex = toHexString(root);
    // Nov-30 13:10:49.789[chain]            warn: No broadcast validation requested for the block broadcastValidation=none,
    // blockRoot=0x087172134cc080500b903268012e9b14697d3d1cd01b3e62ce7f0501512c859b, blockLocallyProduced=false, slot=7877152
    // expect(rootHex).to.be.equal("0x59625c9f56ea94f4eb445c92393dbbd52b506cfbdfc795438c0179873f4aae64");

    for (let i = 0; i < 100; i++) {
      const clonedBlock = signedBeaconBlock.message.clone();
      clonedBlock.body.executionPayload.transactions[0] = crypto.randomBytes(MAX_BYTES_PER_TRANSACTION);
      clonedBlock.commit();
      const json = ssz.capella.BeaconBlock.toJson({...clonedBlock.toValue(), executionPayloadBlinded: false} as capella.BeaconBlock);
      const block2 = ssz.capella.BeaconBlock.fromJson(json);
      const root2 = ssz.capella.BeaconBlock.hashTreeRoot(block2);
      const rootHex2 = toHexString(root2);
      expect(rootHex2).to.be.equal(rootHex);
      console.log("@@@ passing test: ", i);
    }

  });

  it.only("toJson fromJson test", () => {
    let count = 0;
    // for (let i = 7877152; i <= 7877152 + 100; i++) {
    for (let i = 7877252; i <= 7877252 + 1000; i++) {
      let blockBytes: Uint8Array;
      try {
        // blockBytes = fs.readFileSync(`/Users/tuyennguyen/tuyen/blocks_7877152_7877252/block_${i}.ssz`);
        blockBytes = fs.readFileSync(`/Users/tuyennguyen/tuyen/blocks_7877252_7878252/block_${i}.ssz`);
      } catch (e) {
        console.log(`Skip block ${i}`);
        continue;
      }
      if (blockBytes.length < 100) {
        console.log(`Skip block slot ${i} ${blockBytes.length} bytes`);
        continue;
      }
      console.log(`Testing block slot ${i} ${blockBytes.length} bytes`);
      const signedBeaconBlock = ssz.capella.SignedBeaconBlock.deserializeToViewDU(blockBytes);
      const root = signedBeaconBlock.message.hashTreeRoot();
      const rootHex = toHexString(root);
      const json = ssz.capella.BeaconBlock.toJson({...signedBeaconBlock.message.toValue(), executionPayloadBlinded: false} as capella.BeaconBlock);
      const clonedJson = {
        execution_payload_blinded: false,
        ...json as Record<string, unknown>
      };
      const jsonString = JSON.stringify(clonedJson);
      const newJson = JSON.parse(jsonString);
      const block2 = ssz.capella.BeaconBlock.fromJson(newJson);
      const root2 = ssz.capella.BeaconBlock.hashTreeRoot(block2);
      const rootHex2 = toHexString(root2);
      expect(rootHex2).to.be.equal(rootHex);
      // const jsonString2 = JSON.stringify(ssz.capella.BeaconBlock.toJson(block2));
      // const newJson2 = JSON.parse(jsonString2);
      // const block3 = ssz.capella.BeaconBlock.fromJson(newJson2);
      // expect(toHexString(ssz.capella.BeaconBlock.hashTreeRoot(block3))).to.be.equal(rootHex);
      const signedBlock = {
        message: block2,
        signature: signedBeaconBlock.signature,
      };
      // console.log("@@@ proposer index", block2.proposerIndex);
      const signedBlockJson = ssz.capella.SignedBeaconBlock.toJson(signedBlock);
      // const signedBlockJsonString = JSON.stringify(signedBlockJson);
      // const signedBlockJson2 = JSON.parse(signedBlockJsonString);
      const signedBlock2 = ssz.capella.SignedBeaconBlock.fromJson(signedBlockJson);
      const signedBlockRoot = ssz.capella.BeaconBlock.hashTreeRoot(signedBlock2.message);
      expect(toHexString(signedBlockRoot)).to.be.equal(rootHex);
      count++;
    }
    console.log(`Tested ${count} blocks`);
  });
});
