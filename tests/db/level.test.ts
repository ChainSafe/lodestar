import { assert } from "chai";
import BN from "bn.js";
import leveldown from "leveldown";
import levelup from "levelup";
import promisify from "promisify-es6";
import {
  serialize,
  treeHash,
} from "@chainsafesystems/ssz";

import {
  BeaconBlock,
  BeaconState,
  Attestation,
} from "../../src/types";

import {LevelDB} from "../../src/db";

import { generateState } from "../utils/state";
import { generateEmptyBlock } from "../utils/block";
import { generateEmptyAttestation } from "../utils/attestation";
import {generateEmptyVoluntaryExit} from "../utils/voluntaryExits";

describe("LevelDB", () => {
  const dbLocation = "./.__testdb";
  const testDb = levelup(leveldown(dbLocation));
  const db = new LevelDB({db: testDb});
  before(async () => {
    await db.start();
  })
  after(async () => {
    await db.stop();
    await promisify(leveldown.destroy)(dbLocation, function() {})
  })
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

  it("should correctly set, get, delete voluntary exits", async () => {
      const testVoluntaryExits = Array.from({length: 10}, (_, i) => {
          const a = generateEmptyVoluntaryExit();
          a.epoch = new BN(i);
          return a;
      });
      for (const a of testVoluntaryExits) {
          await db.setVoluntaryExit(a);
      }
      const actualVoluntaryExits = await db.getVoluntaryExits();
      assert.equal(actualVoluntaryExits.length, testVoluntaryExits.length);
      await db.deleteVoluntaryExits(actualVoluntaryExits);
      const noVoluntaryExits = await db.getVoluntaryExits();
      assert.equal(noVoluntaryExits.length, 0);
  })
});
