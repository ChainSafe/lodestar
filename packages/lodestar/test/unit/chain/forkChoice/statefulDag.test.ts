import { assert } from "chai";

import { StatefulDagLMDGHOST } from "../../../../src/chain/forkChoice/statefulDag/lmdGhost";
import { config } from "@chainsafe/lodestar-config/lib/presets/mainnet";
import sinon, { SinonFakeTimers } from "sinon";

describe("StatefulDagLMDGHOST", () => {
  const genesis = Buffer.from("genesis");
  const a = Buffer.from("a");
  const b = Buffer.from("b");
  const c = Buffer.from("c");
  const d = Buffer.from("d");
  const e = Buffer.from("e");
  const f = Buffer.from("f");
  const g = Buffer.from("g");
  const h = Buffer.from("h");
  const i = Buffer.from("i");
  let clock: SinonFakeTimers;

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
    lmd.addBlock(1, a, genesis, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(2, b, a, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(3, c, b, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(3, d, b, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(3, e, b, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(4, f, c, {root: a, epoch: 0}, {root: a, epoch: 0});
    const head = lmd.head();
    assert.deepEqual(head, f);
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
    lmd.addBlock(1, a, genesis, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(2, b, a, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(3, c, b, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(3, d, b, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(3, e, b, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(4, f, c, {root: a, epoch: 0}, {root: a, epoch: 0});
    // add vote to e
    lmd.addAttestation(e, 1, 3n);
    head = lmd.head();
    assert.deepEqual(head, e, "head should be e");
    // recast e vote to f
    lmd.addAttestation(f, 1, 3n);
    head = lmd.head();
    assert.deepEqual(head, f, "head should be f");
    // add vote to d
    lmd.addAttestation(d, 2, 5n);
    head = lmd.head();
    assert.deepEqual(head, d, "head should be d");
    // add g block
    lmd.addBlock(4, g, d, {root: a, epoch: 0}, {root: a, epoch: 0});
    head = lmd.head();
    assert.deepEqual(head, g, "head should be g");
    // add vote to c
    lmd.addAttestation(c, 3, 2n);
    head = lmd.head();
    assert.deepEqual(head, g, "head should be g");
    // add vote to c
    lmd.addAttestation(c, 4, 1n);
    head = lmd.head();
    assert.deepEqual(head, f, "head should be f");
    // recast co vote to g
    lmd.addAttestation(g, 3, 1n);
    head = lmd.head();
    assert.deepEqual(head, g, "head should be g");
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
    lmd.addBlock(1, a, genesis, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(2, b, a, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(3, c, b, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(4, d, c, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(5, e, d, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(2, f, a, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(3, g, f, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addAttestation(e, 1, 3n);
    head = lmd.head();
    assert.deepEqual(head, e, "head should be e");
    lmd.addAttestation(g, 2, 4n);
    head = lmd.head();
    assert.deepEqual(head, g, "head should be g");
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
    lmd.addBlock(1, a, genesis, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(2, b, a, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(3, c, a, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(4, d, b, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(5, e, b, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(2, f, c, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(3, g, c, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addAttestation(e, 1, 3n);
    head = lmd.head();
    assert.deepEqual(head, e, "head should be e");
    lmd.addAttestation(g, 2, 4n);
    head = lmd.head();
    assert.deepEqual(head, g, "head should be g");
  });

  it("should update justified block initially", () => {
    const lmd = new StatefulDagLMDGHOST(config);
    assert(lmd.shouldUpdateJustifiedCheckpoint(a) === true, "should return true");
  });

  it("should update justified block within SAFE_SLOTS_TO_UPDATE_JUSTIFIED", () => {
    const genesisTime = Math.floor(Date.now() / 1000) - (config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED - 1) * config.params.SECONDS_PER_SLOT;
    const lmd = new StatefulDagLMDGHOST(config);
    lmd.start(genesisTime);
    lmd.addBlock(1, a, genesis, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(2, b, a, {root: a, epoch: 0}, {root: a, epoch: 0});
    assert(lmd.shouldUpdateJustifiedCheckpoint(b) === true, "should return true");
  });

  /**
   * a -- b
   */
  it("should not update justified block after SAFE_SLOTS_TO_UPDATE_JUSTIFIED - 1", () => {
    const lmd = new StatefulDagLMDGHOST(config);
    lmd.addBlock(1, a, genesis, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(2, b, a, {root: b, epoch: 0}, {root: b, epoch: 0});
    const genesisTime = Math.floor(Date.now()/1000) - (config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED + 2) * config.params.SECONDS_PER_SLOT;
    lmd.start(genesisTime);
    // a slot is smaller than justified block slot (b)
    assert(lmd.shouldUpdateJustifiedCheckpoint(a) === false, "should return false");
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
    lmd.addBlock(1, a, genesis, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(2, b, a, {root: b, epoch: 1}, {root: b, epoch: 1});
    lmd.addBlock(3, c, a, {root: b, epoch: 1}, {root: b, epoch: 1});
    const genesisTime = Math.floor(Date.now()/1000) - (config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED + 2) * config.params.SECONDS_PER_SLOT;
    lmd.start(genesisTime);
    // c is a conflicted justified block.
    assert(lmd.shouldUpdateJustifiedCheckpoint(c) === false, "should return false");
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
    lmd.addBlock(1, a, genesis, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(2, b, a, {root: b, epoch: 1}, {root: a, epoch: 0});
    lmd.addBlock(3, c, b, {root: b, epoch: 1}, {root: a, epoch: 0});
    lmd.addBlock(4, d, c, {root: b, epoch: 1}, {root: a, epoch: 0});
    lmd.addBlock(5, e, d, {root: b, epoch: 1}, {root: a, epoch: 0});
    // add vote for d
    lmd.addAttestation(d, 1, 3n);
    assert(lmd.getNode(d).bestTarget === lmd.getNode(e), "e should be best target of d");
    assert(lmd.getNode(c).bestTarget === lmd.getNode(e), "e should be best target of c too");
    assert(lmd.getNode(b).bestTarget === lmd.getNode(e), "e should be best target of b too");
    assert(lmd.getNode(d).bestChild === lmd.getNode(e), "e should be best child of d");
    assert.deepEqual(lmd.head(), e);

    // f set new justified/finalized check point
    lmd.addBlock(6, f, c, {root: c, epoch: 2}, {root: b, epoch: 1});
    assert(lmd.getNode(d).bestChild === null, "e is not best target so d has no best child");
    // so e is not best target anymore although d has more votes
    assert.deepEqual(lmd.head(), f, "f should be the only possible head since it has no conflict justified/finalized epoch");

    // add g as head candidate with good justified/finalized
    lmd.addBlock(7, g, d, {root: c, epoch: 2}, {root: b, epoch: 1});
    assert(lmd.getNode(d).bestChild === lmd.getNode(g), "g should be best child of d");
    assert.deepEqual(lmd.head(), g, "g should be the head because d has more votes anyway");

    // add h as as head candidate with good justified/finalized
    lmd.addBlock(8, h, e, {root: c, epoch: 2}, {root: b, epoch: 1});
    // make e has more votes than g
    lmd.addAttestation(e, 2, 3n);
    // e branch is used to be not eligible for bestTarget but now it's good thanks for h
    assert.deepEqual(lmd.head(), h, "h should be the head because e has more votes");
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
    lmd.addBlock(1, a, genesis, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(2, b, a, {root: b, epoch: 1}, {root: a, epoch: 0});
    lmd.addBlock(3, c, b, {root: b, epoch: 1}, {root: a, epoch: 0});
    lmd.addBlock(4, d, c, {root: b, epoch: 1}, {root: a, epoch: 0});
    lmd.addBlock(5, e, d, {root: b, epoch: 1}, {root: a, epoch: 0});
    lmd.addBlock(6, f, d, {root: b, epoch: 1}, {root: a, epoch: 0});
    // add vote for e
    lmd.addAttestation(e, 1, 3n);
    assert.deepEqual(lmd.head(), e, "e should be the head initially");

    // g is added with conflict epochs
    lmd.addBlock(7, g, c, {root: c, epoch: 2}, {root: b, epoch: 1});
    assert.deepEqual(lmd.head(), g, "g should be the head because it has correct epochs");

    // h is added with good epochs
    lmd.addBlock(8, h, e, {root: c, epoch: 2}, {root: b, epoch: 1});
    // since we voted for e already, h should be the new head
    assert.deepEqual(lmd.head(), h, "h should be the head because e was voted");
  });

  /**
   *                f (bad)
   *               /
   *              d -- e -- i (bad)
   *             /
   *            /
   * a -- b -- c -- g (bad)
   *            \
   *             h (conflict epochs)
   */
  it("should switch best target - all best targets have conflict epochs", () => {
    const lmd = new StatefulDagLMDGHOST(config);
    lmd.addBlock(1, a, genesis, {root: a, epoch: 0}, {root: a, epoch: 0});
    lmd.addBlock(2, b, a, {root: b, epoch: 1}, {root: a, epoch: 0});
    lmd.addBlock(3, c, b, {root: b, epoch: 1}, {root: a, epoch: 0});
    lmd.addBlock(4, d, c, {root: b, epoch: 1}, {root: a, epoch: 0});
    lmd.addBlock(5, e, d, {root: b, epoch: 1}, {root: a, epoch: 0});
    lmd.addBlock(6, f, d, {root: b, epoch: 1}, {root: a, epoch: 0});
    lmd.addBlock(7, g, c, {root: b, epoch: 1}, {root: a, epoch: 0});
    // add vote for g
    lmd.addAttestation(g, 1, 3n);
    assert.deepEqual(lmd.head(), g, "g should be the head initially");

    // h is added with conflict epochs
    lmd.addBlock(8, h, c, {root: c, epoch: 2}, {root: b, epoch: 1});
    assert.deepEqual(lmd.head(), h, "h should be the head because it has correct epochs");

    // i is added with correct new epoch
    lmd.addBlock(9, i, e, {root: c, epoch: 2}, {root: b, epoch: 1});
    // add vote for e
    lmd.addAttestation(e, 2, 6n);
    assert.deepEqual(lmd.head(), i, "i should be the head");
  });
});
