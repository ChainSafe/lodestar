import { assert } from "chai";
import BN from "bn.js";
import {
  serialize,
  treeHash,
} from "@chainsafesystems/ssz";

import {
  BeaconBlock,
  BeaconState,
} from "../../src/types";

import {PouchDb} from "../../src/db";

import { generateState } from "../utils/state";
import { generateEmptyBlock } from "../utils/block";
import { generateEmptyAttestation } from "../utils/attestation";

describe("PouchDB", () => {
  const db = new PouchDb({name: 'testdb'});

  after(async () => {
    await db.clean();
  });

  it("should correctly get and set the state", async () => {
    const testState = generateState();
    await db.setState(testState);
    const actualState = await db.getState();
    assert.deepEqual(serialize(actualState, BeaconState), serialize(testState, BeaconState));
  })
  it("should correctly get and set the finalized state", async () => {
    const testState = generateState();
    await db.setFinalizedState(testState);
    const actualState = await db.getFinalizedState();
    assert.deepEqual(serialize(actualState, BeaconState), serialize(testState, BeaconState));
  })
  it("should correctly get and set a block", async () => {
    const testBlock = generateEmptyBlock();
    const testBlockRoot = treeHash(testBlock, BeaconBlock);
    await db.setBlock(testBlock);
    const actualBlock = await db.getBlock(testBlockRoot);
    assert.deepEqual(serialize(actualBlock, BeaconBlock), serialize(testBlock, BeaconBlock));
  })
  it("should correctly set the chain head", async () => {
      const testState = generateState();
      const testBlock = generateEmptyBlock();
      const slot = new BN(5);
      testBlock.slot = slot;
      const testBlockRoot = treeHash(testBlock, BeaconBlock);
      await db.setBlock(testBlock);
      await db.setChainHead(testState, testBlock);
      const actualBlock = await db.getBlockBySlot(slot);
      assert.deepEqual(serialize(actualBlock, BeaconBlock), serialize(testBlock, BeaconBlock));
  })
  it("should correctly set, get, delete attestations", async () => {
    const testAttestations = Array.from({length: 64}, (_, i) => {
      const a = generateEmptyAttestation();
      a.aggregationBitfield = Buffer.from(i.toString());
      return a;
    })
    for (const a of testAttestations) {
      await db.setAttestation(a);
    }
    const actualAttestations = await db.getAttestations();
    assert.equal(actualAttestations.length, testAttestations.length);
    await db.deleteAttestations(testAttestations);
    const noAttestations = await db.getAttestations();
    assert.equal(noAttestations.length, 0);
  })
});
