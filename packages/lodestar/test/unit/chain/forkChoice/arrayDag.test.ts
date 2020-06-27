import {assert, expect} from "chai";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import sinon, {SinonFakeTimers} from "sinon";
import {Checkpoint, Slot} from "@chainsafe/lodestar-types";
import {GENESIS_EPOCH, GENESIS_SLOT} from "../../../../src/constants";
import {LocalClock} from "../../../../src/chain/clock/local/LocalClock";
import {sleep} from "../../../../src/util/sleep";
import {StubbedBeaconDb} from "../../../utils/stub";
import {toHexString} from "@chainsafe/ssz";
import {NO_NODE} from "../../../../src/chain";
import {ArrayDagLMDGHOST} from "../../../../src/chain/forkChoice/arrayDag/lmdGhost";

describe("ArrayDagLMDGHOST", () => {
  const genesis = Buffer.from("genesis");
  const blockA = Buffer.from("block-a");
  const blockB = Buffer.from("block-b");
  const blockC = Buffer.from("block-c");
  const blockD = Buffer.from("block-d");
  const blockE = Buffer.from("block-e");
  const blockF = Buffer.from("block-f");
  const blockG = Buffer.from("block-g");
  const blockH = Buffer.from("block-h");
  const blockI = Buffer.from("block-i");
  const genesisState = Buffer.from("genesisState");
  const stateA = Buffer.from("state-a");
  const stateB = Buffer.from("state-b");
  const stateC = Buffer.from("state-c");
  const stateD = Buffer.from("state-d");
  const stateE = Buffer.from("state-e");
  const stateF = Buffer.from("state-f");
  const stateG = Buffer.from("state-g");
  const stateH = Buffer.from("state-h");
  const stateI = Buffer.from("state-i");
  let clock: SinonFakeTimers;
  let lmd: ArrayDagLMDGHOST;
  let dbStub: StubbedBeaconDb;

  const addBlock = (
    lmd: ArrayDagLMDGHOST,
    slot: Slot,
    blockRoot: Uint8Array,
    stateRoot: Uint8Array,
    parentRoot: Uint8Array,
    justifiedCheckpoint: Checkpoint,
    finalizedCheckpoint: Checkpoint): void => lmd.addBlock({slot, blockRoot, stateRoot, parentRoot, justifiedCheckpoint, finalizedCheckpoint});

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    dbStub = new StubbedBeaconDb(sinon);
    lmd = new ArrayDagLMDGHOST(config);
  });

  afterEach(() => {
    clock.restore();
  });

  it("should call onTick per epoch", async () => {
    const spy = sinon.spy();
    const genesisTime = Math.floor(Date.now() / 1000);
    lmd.onTick = spy;
    const realClock = new LocalClock(config, Math.round(Date.now() / 1000));
    await realClock.start();
    lmd.start(genesisTime, realClock);
    // wait for next epoch to run onNewEpoch
    const timePerEpoch = 1 * config.params.SLOTS_PER_EPOCH * config.params.SECONDS_PER_SLOT * 1000;
    const promise = sleep(timePerEpoch);
    clock.tick(timePerEpoch);
    await promise;
    expect(spy.callCount).to.be.equal(1);
    await lmd.stop();
    // 1 more epoch to check execute onTick
    const promise2 = sleep(timePerEpoch);
    clock.tick(1 * timePerEpoch);
    await promise2;
    // no more onTick call
    expect(spy.callCount).to.be.equal(1);
  });

  it("should accept blocks to create a DAG", () => {
    /*
     *           c -- f
     *         /
     *        /
     * a -- b -- d
     *        \
     *         \
     *           e
     */
    addBlock(lmd, GENESIS_SLOT, genesis, genesisState, Buffer.alloc(32), {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockC, stateC, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockD, stateD, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockE, stateE, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 4, blockF, stateF, blockC, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    const head = lmd.headBlockRoot();
    assert.deepEqual(head, blockF);
    const headStateRoot = lmd.headStateRoot();
    assert.deepEqual(headStateRoot, stateF);
  });
  it("should accept attestations and correctly compute the head - 1", () => {
    /*
     *           c -- f
     *         /
     *        /
     * a -- b -- d (-- g)
     *        \
     *         \
     *           e
     */
    let head: Uint8Array;
    addBlock(lmd, GENESIS_SLOT, genesis, genesisState, Buffer.alloc(32), {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockC, stateC, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockD, stateD, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockE, stateE, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 4, blockF, stateF, blockC, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    // add vote to e
    lmd.addAttestation(blockE, 1, 3n);
    head = lmd.headBlockRoot();
    assert.deepEqual(head, blockE, "head should be e");
    // recast e vote to f
    lmd.addAttestation(blockF, 1, 3n);
    head = lmd.headBlockRoot();
    assert.deepEqual(head, blockF, "head should be f");
    // add vote to d
    lmd.addAttestation(blockD, 2, 5n);
    head = lmd.headBlockRoot();
    assert.deepEqual(head, blockD, "head should be d");
    // add g block
    addBlock(lmd, 4, blockG, stateG, blockD, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    head = lmd.headBlockRoot();
    assert.deepEqual(head, blockG, "head should be g");
    // add vote to c
    lmd.addAttestation(blockC, 3, 2n);
    head = lmd.headBlockRoot();
    assert.deepEqual(head, blockG, "head should be g");
    // add vote to c
    lmd.addAttestation(blockC, 4, 1n);
    head = lmd.headBlockRoot();
    assert.deepEqual(head, blockF, "head should be f");
    // recast co vote to g
    lmd.addAttestation(blockG, 3, 1n);
    head = lmd.headBlockRoot();
    assert.deepEqual(head, blockG, "head should be g");
    const headStateRoot = lmd.headStateRoot();
    assert.deepEqual(headStateRoot, stateG);
  });
  it("should accept attestations and correctly compute the head - 2", () => {
    /*
     *      f -- g
     *    /
     *   /
     * a -- b -- c -- d -- e
     *
     *
     *
     */
    let head: Uint8Array;
    addBlock(lmd, GENESIS_SLOT, genesis, genesisState, Buffer.alloc(32), {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockC, stateC, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 4, blockD, stateD, blockC, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 5, blockE, stateE, blockD, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockF, stateF, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockG, stateG, blockF, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    lmd.addAttestation(blockE, 1, 3n);
    head = lmd.headBlockRoot();
    assert.deepEqual(head, blockE, "head should be e");
    lmd.addAttestation(blockG, 2, 4n);
    head = lmd.headBlockRoot();
    assert.deepEqual(head, blockG, "head should be g");
    const headStateRoot = lmd.headStateRoot();
    assert.deepEqual(headStateRoot, stateG);
  });
  it("should accept attestations and correctly compute the head - 3", () => {
    /*
     *           d
     *         /
     *        /
     *      b -- e
     *    /
     *   /
     * a
     *   \
     *    \
     *      c -- f
     *        \
     *         \
     *           g
     */
    let head: Uint8Array;
    addBlock(lmd, GENESIS_SLOT, genesis, genesisState, Buffer.alloc(32), {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockC, stateC, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 4, blockD, stateD, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 5, blockE, stateE, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockF, stateF, blockC, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockG, stateG, blockC, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    lmd.addAttestation(blockE, 1, 3n);
    head = lmd.headBlockRoot();
    assert.deepEqual(head, blockE, "head should be e");
    const headStateRoot = lmd.headStateRoot();
    assert.deepEqual(headStateRoot, stateE);
    lmd.addAttestation(blockG, 2, 4n);
    head = lmd.headBlockRoot();
    assert.deepEqual(head, blockG, "head should be g");
  });

  describe("shouldUpdateJustifiedCheckpoint", () => {
    it("should update justified block initially", () => {
      // addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
      assert(lmd.shouldUpdateJustifiedCheckpoint(blockA) === true, "should return true");
    });

    it("should update justified block within SAFE_SLOTS_TO_UPDATE_JUSTIFIED", () => {
      const genesisTime = Math.floor(Date.now() / 1000) - (config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED - 1) * config.params.SECONDS_PER_SLOT;
      lmd.start(genesisTime, new LocalClock(config, Math.round(Date.now() / 1000)));
      addBlock(lmd, GENESIS_SLOT, genesis, genesisState, Buffer.alloc(32), {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
      addBlock(lmd, 2, blockB, stateB, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
      assert(lmd.shouldUpdateJustifiedCheckpoint(blockB) === true, "should return true");
    });

    /**
     *
     * a -- b
     *  \
     *   \
     *    \
     *     \
     *      \
     *       \
     *        c
     */
    it("should not update justified block because conflict justified check point", () => {
      addBlock(lmd, GENESIS_SLOT, genesis, genesisState, Buffer.alloc(32), {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
      const blockBSlot = 1 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, blockBSlot, blockB, stateB, blockA, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
      const blockCSlot = 2 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, blockCSlot, blockC, stateC, blockA, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
      const genesisTime = Math.floor(Date.now() / 1000) - (config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED + 2) * config.params.SECONDS_PER_SLOT;
      lmd.start(genesisTime, new LocalClock(config, Math.round(Date.now() / 1000)));
      // c is a conflicted justified block.
      assert(lmd.shouldUpdateJustifiedCheckpoint(blockC) === false, "should return false because not on same branch");
    });

    /**
     *
     * a -- b -- c
     */
    it("should not update justified block because conflict justified check point", () => {
      addBlock(lmd, GENESIS_SLOT, genesis, genesisState, Buffer.alloc(32), {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
      const blockBSlot = 1 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, blockBSlot, blockB, stateB, blockA, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
      const blockCSlot = 2 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, blockCSlot, blockC, stateC, blockB, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
      const genesisTime = Math.floor(Date.now() / 1000) - (config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED + 2) * config.params.SECONDS_PER_SLOT;
      lmd.start(genesisTime, new LocalClock(config, Math.round(new Date().getTime() /1000)));
      // c is a conflicted justified block.
      assert(lmd.shouldUpdateJustifiedCheckpoint(blockC) === true, "should be able to update justified checkpoint");
    });
  });

  describe("update justified checkpoint after finalized checkpoint is set", () => {
    /**
       *              b -- d -- e
       *             / \
       *            /   c -- f -- g
       * genesis - a
       */
    // shouldUpdateJustifiedCheckpoint returns false but we still update justified checkpoint finally
    it("should update justified checkpoint - new justified is conflict to the previous justified", () => {
      addBlock(lmd, GENESIS_SLOT, genesis, genesisState, Buffer.alloc(32), {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotA = 1 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotA, blockA, stateA, genesis, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotB = 2 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotB, blockB, stateB, blockA, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotC = 3 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotC, blockC, stateC, blockB, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotD = 4 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotD, blockD, stateD, blockB, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotE = 5 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotE, blockE, stateE, blockD, {root: blockD, epoch: 4}, {root: blockA, epoch: 1});
      assert.deepEqual(lmd.getFinalized(), {root: blockA, epoch: 1});
      assert.deepEqual(lmd.getJustified(), {root: blockD, epoch: 4});

      // This creates a justified with conflict fork, still update it
      const slotF = 6 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotF, blockF, stateF, blockC, {root: blockC, epoch: 3}, {root: blockA, epoch: 1});
      assert.equal(lmd.shouldUpdateJustifiedCheckpoint(blockF), false);
      assert.deepEqual(lmd.getFinalized(), {root: blockA, epoch: 1});
      // C is conflict to D so not able to update justified
      assert.deepEqual(lmd.getJustified(), {root: blockD, epoch: 4});
      const slotG = 7 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotG, blockG, stateG, blockF, {root: blockF, epoch: 6}, {root: blockC, epoch: 3});

      assert.deepEqual(lmd.getFinalized(), {root: blockC, epoch: 3});
      // F is conflict to the previous justified block but we still set it finally
      assert.deepEqual(lmd.getJustified(), {root: blockF, epoch: 6});
    });
  });

  describe("ensure bestTarget has same finalized/justified checkpoint like the store", () => {
    /**
       *                g
       *               /
       *              d -- e -- h
       *             /
       *            /
       * a -- b -- c
       *            \
       *             \
       *              f
       */
    it("should switch best target - bad best target has no sibling", () => {
      addBlock(lmd, GENESIS_SLOT, genesis, genesisState, Buffer.alloc(32), {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotA = 1 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotA, blockA, stateA, genesis, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotB = 2 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotB, blockB, stateB, blockA, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotC = 3 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotC, blockC, stateC, blockB, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotD = 4 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotD, blockD, stateD, blockC, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotE = 5 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotE, blockE, stateE, blockD, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      // add vote for d
      lmd.addAttestation(blockD, 1, 3n);
      assert(lmd.isBestTarget(lmd.getNode(blockD), lmd.getNode(blockE)), "e should be best target of d");
      assert(lmd.isBestTarget(lmd.getNode(blockC), lmd.getNode(blockE)), "e should be best target of c too");
      assert(lmd.isBestTarget(lmd.getNode(blockB), lmd.getNode(blockE)), "e should be best target of b too");
      assert(lmd.isBestChild(lmd.getNode(blockD), lmd.getNode(blockE)), "e should be best child of d");
      assert.deepEqual(lmd.headBlockRoot(), blockE);

      // f set new justified/finalized check point
      const slotF = 6 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotF, blockF, stateF, blockC, {root: blockC, epoch: 3}, {root: blockB, epoch: 2});
      assert(lmd.getNode(blockD).hasBestChild() === false, "e is not best target so d has no best child");
      // so e is not best target anymore although d has more votes
      assert.deepEqual(lmd.headBlockRoot(), blockF, "f should be the only possible head since it has no conflict justified/finalized epoch");

      // add g as head candidate with good justified/finalized
      const slotG = 7 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotG, blockG, stateG, blockD, {root: blockC, epoch: 3}, {root: blockB, epoch: 2});
      assert(lmd.isBestChild(lmd.getNode(blockD), lmd.getNode(blockG)), "g should be best child of d");
      assert.deepEqual(lmd.headBlockRoot(), blockG, "g should be the head because d has more votes anyway");

      // add h as as head candidate with good justified/finalized
      const slotH = 8 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotH, blockH, stateH, blockE, {root: blockC, epoch: 3}, {root: blockB, epoch: 2});
      // make e has more votes than g
      lmd.addAttestation(blockE, 2, 3n);
      // e branch is used to be not eligible for bestTarget but now it's good thanks for h
      assert.deepEqual(lmd.headBlockRoot(), blockH, "h should be the head because e has more votes");
      const headStateRoot = lmd.headStateRoot();
      assert.deepEqual(headStateRoot, stateH);
    });

    /**
     *                f (bad)
     *               /  (bad)
     *              d -- e -- h
     *             /
     *            /
     * a -- b -- c
     *            \
     *             \
     *              g (conflict epochs)
     */
    it("should switch best target - bad best target has bad sibling too", () => {
      addBlock(lmd, GENESIS_SLOT, genesis, genesisState, Buffer.alloc(32), {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotA = 1 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotA, blockA, stateA, genesis, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotB = 2 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotB, blockB, stateB, blockA, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotC = 3 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotC, blockC, stateC, blockB, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotD = 4 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotD, blockD, stateD, blockC, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotE = 5 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotE, blockE, stateE, blockD, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotF = 6 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotF, blockF, stateF, blockD, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      // add vote for e
      lmd.addAttestation(blockE, 1, 3n);
      assert.deepEqual(lmd.headBlockRoot(), blockE, "e should be the head initially");

      // g is added with conflict epochs
      const slotG = 7 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotG, blockG, stateG, blockC, {root: blockC, epoch: 3}, {root: blockB, epoch: 2});
      assert.deepEqual(lmd.headBlockRoot(), blockG, "g should be the head because it has correct epochs");

      // h is added with good epochs
      const slotH = 8 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotH, blockH, stateH, blockE, {root: blockC, epoch: 3}, {root: blockB, epoch: 2});
      // since we voted for e already, h should be the new head
      assert.deepEqual(lmd.headBlockRoot(), blockH, "h should be the head because e was voted");
      const headStateRoot = lmd.headStateRoot();
      assert.deepEqual(headStateRoot, stateH);
    });

    /**
     *                f (bad)
     *               /  (bad)
     *              d -- e -- i
     *             /
     *            /
     * blockA -- b -- c -- g (bad)
     *            \
     *             h (conflict epochs)
     */
    it("should switch best target - all best targets have conflict epochs", () => {
      addBlock(lmd, GENESIS_SLOT, genesis, genesisState, Buffer.alloc(32), {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotA = 1 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotA, blockA, stateA, genesis, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotB = 2 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotB, blockB, stateB, blockA, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotC = 3 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotC, blockC, stateC, blockB, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotD = 4 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotD, blockD, stateD, blockC, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotE = 5 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotE, blockE, stateE, blockD, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotF = 6 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotF, blockF, stateF, blockD, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotG = 7 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotG, blockG, stateG, blockC, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      // add vote for g
      lmd.addAttestation(blockG, 1, 3n);
      assert.deepEqual(lmd.headBlockRoot(), blockG, "g should be the head initially");

      // h is added with conflict epochs
      const slotH = 8 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotH, blockH, stateH, blockC, {root: blockC, epoch: 3}, {root: blockB, epoch: 2});
      assert.deepEqual(lmd.headBlockRoot(), blockH, "h should be the head because it has correct epochs");

      // i is added with correct new epoch
      const slotI = 9 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotI, blockI, stateI, blockE, {root: blockC, epoch: 3}, {root: blockB, epoch: 2});
      // add vote for e
      lmd.addAttestation(blockE, 2, 6n);
      assert.deepEqual(lmd.headBlockRoot(), blockI, "i should be the head");
      const headStateRoot = lmd.headStateRoot();
      assert.deepEqual(headStateRoot, stateI);
    });
  });

  describe("ensure correct indices", () => {
    /**
     *              b -- d -- e
     *             / \
     *            /   c -- f
     * genesis - a
     */
    it("should update indices after setting new finalized check point", () => {
      addBlock(lmd, GENESIS_SLOT, genesis, genesisState, Buffer.alloc(32), {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotA = 1 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotA, blockA, stateA, genesis, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotB = 2 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotB, blockB, stateB, blockA, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotC = 3 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotC, blockC, stateC, blockB, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      const slotD = 4 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotD, blockD, stateD, blockB, {root: genesis, epoch: GENESIS_EPOCH}, {root: genesis, epoch: GENESIS_EPOCH});
      expect(lmd.getNode(blockD)).to.be.deep.equal({
        slot: 4 * config.params.SLOTS_PER_EPOCH,
        blockRoot: toHexString(blockD),
        stateRoot: stateD,
        weight: 0n,
        parent: 2,
        bestChild: null,
        bestTarget: 4,
        justifiedCheckpoint: {rootHex: toHexString(genesis), epoch: GENESIS_EPOCH},
        finalizedCheckpoint: {rootHex: toHexString(genesis), epoch: GENESIS_EPOCH},
        children: {},
      });
      const slotE = 5 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotE, blockE, stateE, blockD, {root: blockD, epoch: 4}, {root: blockA, epoch: 1});
      assert.deepEqual(lmd.getFinalized(), {root: blockA, epoch: 1});
      assert.deepEqual(lmd.getJustified(), {root: blockD, epoch: 4});
      // blockA is new finalized checkpoint => shift index by 1, note best child & target
      expect(lmd.getNode(blockD)).to.be.deep.equal({
        slot: 4 * config.params.SLOTS_PER_EPOCH,
        blockRoot: toHexString(blockD),
        stateRoot: stateD,
        weight: 0n,
        parent: 1,//B = 2 - 1
        bestChild: 4, // E = 5 - 1
        bestTarget: 4,// E
        justifiedCheckpoint: {rootHex: toHexString(genesis), epoch: GENESIS_EPOCH},
        finalizedCheckpoint: {rootHex: toHexString(genesis), epoch: GENESIS_EPOCH},
        children: {[toHexString(blockE)]: 4}, // E
      });

      // This creates a justified with conflict fork, still update it
      const slotF = 6 * config.params.SLOTS_PER_EPOCH;
      addBlock(lmd, slotF, blockF, stateF, blockC, {root: blockC, epoch: 3}, {root: blockB, epoch: 2});
      // blockB is new finalized checkpoint => shift index by 1 more
      // remaining nodes: B=0 C=1 D=2 E=3 F=4
      expect(lmd.getNode(blockD)).to.be.deep.equal({
        slot: 4 * config.params.SLOTS_PER_EPOCH,
        blockRoot: toHexString(blockD),
        stateRoot: stateD,
        weight: 0n,
        parent: 0,//B = 1 - 1
        bestChild: NO_NODE, // unassign best child due to conflict checkpoints
        bestTarget: 3,// E = 4 - 1
        justifiedCheckpoint: {rootHex: toHexString(genesis), epoch: GENESIS_EPOCH},
        finalizedCheckpoint: {rootHex: toHexString(genesis), epoch: GENESIS_EPOCH},
        children: {[toHexString(blockE)]: 3}, // E
      });
    });
  });

});
