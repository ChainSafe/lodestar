import {assert} from "chai";

import {StatefulDagLMDGHOST} from "../../../../src/chain/forkChoice/statefulDag/lmdGhost";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import sinon, {SinonFakeTimers} from "sinon";
import {Checkpoint, Slot} from "@chainsafe/lodestar-types";

describe("StatefulDagLMDGHOST", () => {
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

  const addBlock = (
    lmd: StatefulDagLMDGHOST, 
    slot: Slot, 
    blockRootBuf: Uint8Array, 
    stateRootBuf: Uint8Array, 
    parentRootBuf: Uint8Array, 
    justifiedCheckpoint: Checkpoint, 
    finalizedCheckpoint: Checkpoint): void => lmd.addBlock({slot, blockRootBuf, stateRootBuf, parentRootBuf, justifiedCheckpoint, finalizedCheckpoint});

  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
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
    const lmd = new StatefulDagLMDGHOST(config);
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockC, stateC, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockD, stateD, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockE, stateE, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 4, blockF, stateF, blockC, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    const head = lmd.head();
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
    const lmd = new StatefulDagLMDGHOST(config);
    let head: Uint8Array;
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockC, stateC, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockD, stateD, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockE, stateE, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 4, blockF, stateF, blockC, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    // add vote to e
    lmd.addAttestation(blockE, 1, 3n);
    head = lmd.head();
    assert.deepEqual(head, blockE, "head should be e");
    // recast e vote to f
    lmd.addAttestation(blockF, 1, 3n);
    head = lmd.head();
    assert.deepEqual(head, blockF, "head should be f");
    // add vote to d
    lmd.addAttestation(blockD, 2, 5n);
    head = lmd.head();
    assert.deepEqual(head, blockD, "head should be d");
    // add g block
    addBlock(lmd, 4, blockG, stateG, blockD, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    head = lmd.head();
    assert.deepEqual(head, blockG, "head should be g");
    // add vote to c
    lmd.addAttestation(blockC, 3, 2n);
    head = lmd.head();
    assert.deepEqual(head, blockG, "head should be g");
    // add vote to c
    lmd.addAttestation(blockC, 4, 1n);
    head = lmd.head();
    assert.deepEqual(head, blockF, "head should be f");
    // recast co vote to g
    lmd.addAttestation(blockG, 3, 1n);
    head = lmd.head();
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
    const lmd = new StatefulDagLMDGHOST(config);
    let head: Uint8Array;
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockC, stateC, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 4, blockD, stateD, blockC, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 5, blockE, stateE, blockD, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockF, stateF, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockG, stateG, blockF, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    lmd.addAttestation(blockE, 1, 3n);
    head = lmd.head();
    assert.deepEqual(head, blockE, "head should be e");
    lmd.addAttestation(blockG, 2, 4n);
    head = lmd.head();
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
    const lmd = new StatefulDagLMDGHOST(config);
    let head: Uint8Array;
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockC, stateC, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 4, blockD, stateD, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 5, blockE, stateE, blockB, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockF, stateF, blockC, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockG, stateG, blockC, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    lmd.addAttestation(blockE, 1, 3n);
    head = lmd.head();
    assert.deepEqual(head, blockE, "head should be e");
    const headStateRoot = lmd.headStateRoot();
    assert.deepEqual(headStateRoot, stateE);
    lmd.addAttestation(blockG, 2, 4n);
    head = lmd.head();
    assert.deepEqual(head, blockG, "head should be g");
  });

  it("should update justified block initially", () => {
    const lmd = new StatefulDagLMDGHOST(config);
    // addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    assert(lmd.shouldUpdateJustifiedCheckpoint(blockA) === true, "should return true");
  });

  it("should update justified block within SAFE_SLOTS_TO_UPDATE_JUSTIFIED", () => {
    const genesisTime = Math.floor(Date.now() / 1000) - (config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED - 1) * config.params.SECONDS_PER_SLOT;
    const lmd = new StatefulDagLMDGHOST(config);
    lmd.start(genesisTime);
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    assert(lmd.shouldUpdateJustifiedCheckpoint(blockB) === true, "should return true");
  });

  /**
   * a -- b
   */
  it("should not update justified block after SAFE_SLOTS_TO_UPDATE_JUSTIFIED - 1", () => {
    const lmd = new StatefulDagLMDGHOST(config);
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockB, epoch: 0}, {root: blockB, epoch: 0});
    const genesisTime = Math.floor(Date.now() / 1000) - (config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED + 2) * config.params.SECONDS_PER_SLOT;
    lmd.start(genesisTime);
    // a slot is smaller than justified block slot (b)
    assert(lmd.shouldUpdateJustifiedCheckpoint(blockA) === false, "should return false");
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
  it("should not update justified block after SAFE_SLOTS_TO_UPDATE_JUSTIFIED - 2", () => {
    const lmd = new StatefulDagLMDGHOST(config);
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockB, epoch: 1}, {root: blockB, epoch: 1});
    addBlock(lmd, 3, blockC, stateC, blockA, {root: blockB, epoch: 1}, {root: blockB, epoch: 1});
    const genesisTime = Math.floor(Date.now() / 1000) - (config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED + 2) * config.params.SECONDS_PER_SLOT;
    lmd.start(genesisTime);
    // c is a conflicted justified block.
    assert(lmd.shouldUpdateJustifiedCheckpoint(blockC) === false, "should return false");
  });

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
    const lmd = new StatefulDagLMDGHOST(config);
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockA, epoch: 1}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockC, stateC, blockB, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    addBlock(lmd, 4, blockD, stateD, blockC, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    addBlock(lmd, 5, blockE, stateE, blockD, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    // add vote for d
    lmd.addAttestation(blockD, 1, 3n);
    assert(lmd.getNode(blockD).bestTarget === lmd.getNode(blockE), "e should be best target of d");
    assert(lmd.getNode(blockC).bestTarget === lmd.getNode(blockE), "e should be best target of c too");
    assert(lmd.getNode(blockB).bestTarget === lmd.getNode(blockE), "e should be best target of b too");
    assert(lmd.getNode(blockD).bestChild === lmd.getNode(blockE), "e should be best child of d");
    assert.deepEqual(lmd.head(), blockE);

    // f set new justified/finalized check point
    addBlock(lmd, 6, blockF, stateF, blockC, {root: blockC, epoch: 2}, {root: blockB, epoch: 1});
    assert(lmd.getNode(blockD).bestChild === null, "e is not best target so d has no best child");
    // so e is not best target anymore although d has more votes
    assert.deepEqual(lmd.head(), blockF, "f should be the only possible head since it has no conflict justified/finalized epoch");

    // add g as head candidate with good justified/finalized
    addBlock(lmd, 7, blockG, stateG, blockD, {root: blockC, epoch: 2}, {root: blockB, epoch: 1});
    assert(lmd.getNode(blockD).bestChild === lmd.getNode(blockG), "g should be best child of d");
    assert.deepEqual(lmd.head(), blockG, "g should be the head because d has more votes anyway");

    // add h as as head candidate with good justified/finalized
    addBlock(lmd, 8, blockH, stateH, blockE, {root: blockC, epoch: 2}, {root: blockB, epoch: 1});
    // make e has more votes than g
    lmd.addAttestation(blockE, 2, 3n);
    // e branch is used to be not eligible for bestTarget but now it's good thanks for h
    assert.deepEqual(lmd.head(), blockH, "h should be the head because e has more votes");
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
    const lmd = new StatefulDagLMDGHOST(config);
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockC, stateC, blockB, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    addBlock(lmd, 4, blockD, stateD, blockC, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    addBlock(lmd, 5, blockE, stateE, blockD, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    addBlock(lmd, 6, blockF, stateF, blockD, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    // add vote for e
    lmd.addAttestation(blockE, 1, 3n);
    assert.deepEqual(lmd.head(), blockE, "e should be the head initially");

    // g is added with conflict epochs
    addBlock(lmd, 7, blockG, stateG, blockC, {root: blockC, epoch: 2}, {root: blockB, epoch: 1});
    assert.deepEqual(lmd.head(), blockG, "g should be the head because it has correct epochs");

    // h is added with good epochs
    addBlock(lmd, 8, blockH, stateH, blockE, {root: blockC, epoch: 2}, {root: blockB, epoch: 1});
    // since we voted for e already, h should be the new head
    assert.deepEqual(lmd.head(), blockH, "h should be the head because e was voted");
    const headStateRoot = lmd.headStateRoot();
    assert.deepEqual(headStateRoot, stateH);
  });

  /**
   *                f (bad)
   *               /
   *              d -- e -- i (bad)
   *             /
   *            /
   * blockA -- b -- c -- g (bad)
   *            \
   *             h (conflict epochs)
   */
  it("should switch best target - all best targets have conflict epochs", () => {
    const lmd = new StatefulDagLMDGHOST(config);
    addBlock(lmd, 1, blockA, stateA, genesis, {root: blockA, epoch: 0}, {root: blockA, epoch: 0});
    addBlock(lmd, 2, blockB, stateB, blockA, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    addBlock(lmd, 3, blockC, stateC, blockB, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    addBlock(lmd, 4, blockD, stateD, blockC, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    addBlock(lmd, 5, blockE, stateE, blockD, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    addBlock(lmd, 6, blockF, stateF, blockD, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    addBlock(lmd, 7, blockG, stateG, blockC, {root: blockB, epoch: 1}, {root: blockA, epoch: 0});
    // add vote for g
    lmd.addAttestation(blockG, 1, 3n);
    assert.deepEqual(lmd.head(), blockG, "g should be the head initially");

    // h is added with conflict epochs
    addBlock(lmd, 8, blockH, stateH, blockC, {root: blockC, epoch: 2}, {root: blockB, epoch: 1});
    assert.deepEqual(lmd.head(), blockH, "h should be the head because it has correct epochs");

    // i is added with correct new epoch
    addBlock(lmd, 9, blockI, stateI, blockE, {root: blockC, epoch: 2}, {root: blockB, epoch: 1});
    // add vote for e
    lmd.addAttestation(blockE, 2, 6n);
    assert.deepEqual(lmd.head(), blockI, "i should be the head");
    const headStateRoot = lmd.headStateRoot();
    assert.deepEqual(headStateRoot, stateI);
  });
});
