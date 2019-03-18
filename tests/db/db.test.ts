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

import {DB} from "../../src/db";

import { generateState } from "../utils/state";
import { generateEmptyBlock } from "../utils/block";
import { generateEmptyAttestation } from "../utils/attestation";

describe("DB", () => {
  const dbLocation = "./.__testdb";
  const testDb = levelup(leveldown(dbLocation));
  const db = new DB({db: testDb});
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
  it("should correctly get and set an attestation", async () => {
    const testAttestation = generateEmptyAttestation();
    const testAttestationRoot = treeHash(testAttestation, Attestation);
    await db.setAttestation(testAttestation);
    const actualAttestation = await db.getAttestation(testAttestationRoot);
    assert.deepEqual(serialize(actualAttestation, Attestation), serialize(testAttestation, Attestation));
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
});
