import {assert} from "chai";
import leveldown from "leveldown";
import promisify from "promisify-es6";
import {hashTreeRoot, serialize,} from "@chainsafe/ssz";

import {BeaconBlock, BeaconState,} from "../../../src/types";

import {LevelDB} from "../../../src/db";

import {generateState} from "../../utils/state";
import {generateEmptyBlock} from "../../utils/block";
import {generateEmptyAttestation} from "../../utils/attestation";
import {generateEmptyVoluntaryExit} from "../../utils/voluntaryExits";
import level from "level";
import logger from "../../../src/logger/winston";
import {generateDeposit} from "../../utils/deposit";

describe("LevelDB", () => {
  const dbLocation = "./.__testdb";
  const testDb = level(
    dbLocation, {
      keyEncoding: 'binary',
      valueEncoding: 'binary',
    });
  const db = new LevelDB({db: testDb});
  before(async () => {
    logger.silent(true);
    await db.start();
  });
  after(async () => {
    await db.stop();
    await promisify(leveldown.destroy)(dbLocation, function () {
    });
    logger.silent(false);
  });
  it("should correctly get and set the state", async () => {
    const testState = generateState();
    await db.setState(testState);
    const actualState = await db.getState();
    assert.deepEqual(serialize(actualState, BeaconState), serialize(testState, BeaconState));
  });
  it("should correctly get and set the finalized state", async () => {
    const testState = generateState();
    await db.setFinalizedState(testState);
    const actualState = await db.getFinalizedState();
    assert.deepEqual(serialize(actualState, BeaconState), serialize(testState, BeaconState));
  });
  it("should correctly get and set a block", async () => {
    const testBlock = generateEmptyBlock();
    const testBlockRoot = hashTreeRoot(testBlock, BeaconBlock);
    await db.setBlock(testBlock);
    const actualBlock = await db.getBlock(testBlockRoot);
    assert.deepEqual(serialize(actualBlock, BeaconBlock), serialize(testBlock, BeaconBlock));
  });
  it("should correctly set the chain head", async () => {
    const testState = generateState();
    const testBlock = generateEmptyBlock();
    const slot = 5;
    testBlock.slot = slot;
    const testBlockRoot = hashTreeRoot(testBlock, BeaconBlock);
    await db.setBlock(testBlock);
    await db.setChainHead(testState, testBlock);
    const actualBlock = await db.getBlockBySlot(slot);
    assert.deepEqual(serialize(actualBlock, BeaconBlock), serialize(testBlock, BeaconBlock));
  });
  it("should correctly set, get, delete attestations", async () => {
    const testAttestations = Array.from({length: 64}, (_, i) => {
      const a = generateEmptyAttestation();
      a.aggregationBitfield = Buffer.from(i.toString());
      return a;
    });
    for (const a of testAttestations) {
      await db.setAttestation(a);
    }
    const actualAttestations = await db.getAttestations();
    assert.equal(actualAttestations.length, testAttestations.length);
    await db.deleteAttestations(testAttestations);
    const noAttestations = await db.getAttestations();
    assert.equal(noAttestations.length, 0);
  });

  it("should correctly set, get, delete genesis deposits", async () => {
    const testDeposits = Array.from({length: 64}, (_, i) => {
      return generateDeposit(i);
    });
    for (const a of testDeposits) {
      await db.setGenesisDeposit(a);
    }
    const actualDeposits = await db.getGenesisDeposits();
    assert.equal(actualDeposits.length, actualDeposits.length);
    await db.deleteGenesisDeposits(testDeposits);
    const noDeposits = await db.getGenesisDeposits();
    assert.equal(noDeposits.length, 0);
  });

  it("should correctly set, get, delete voluntary exits", async () => {
    const testVoluntaryExits = Array.from({length: 10}, (_, i) => {
      const a = generateEmptyVoluntaryExit();
      a.epoch = i;
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
  });
});
