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
    lmd.addBlock(1, a, genesis, { root: a, epoch: 0 }, { root: a, epoch: 0 });
    lmd.addBlock(2, b, a);
    lmd.addBlock(3, c, b);
    lmd.addBlock(3, d, b);
    lmd.addBlock(3, e, b);
    lmd.addBlock(4, f, c);
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
    lmd.addBlock(1, a, genesis, { root: a, epoch: 0 }, { root: a, epoch: 0 });
    lmd.addBlock(2, b, a);
    lmd.addBlock(3, c, b);
    lmd.addBlock(3, d, b);
    lmd.addBlock(3, e, b);
    lmd.addBlock(4, f, c);
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
    lmd.addBlock(4, g, d);
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
    lmd.addBlock(1, a, genesis, { root: a, epoch: 0 }, { root: a, epoch: 0 });
    lmd.addBlock(2, b, a);
    lmd.addBlock(3, c, b);
    lmd.addBlock(4, d, c);
    lmd.addBlock(5, e, d);
    lmd.addBlock(2, f, a);
    lmd.addBlock(3, g, f);
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
    lmd.addBlock(1, a, genesis, { root: a, epoch: 0 }, { root: a, epoch: 0 });
    lmd.addBlock(2, b, a);
    lmd.addBlock(3, c, a);
    lmd.addBlock(4, d, b);
    lmd.addBlock(5, e, b);
    lmd.addBlock(2, f, c);
    lmd.addBlock(3, g, c);
    lmd.addAttestation(e, 1, 3n);
    head = lmd.head();
    assert.deepEqual(head, e, "head should be e");
    lmd.addAttestation(g, 2, 4n);
    head = lmd.head();
    assert.deepEqual(head, g, "head should be g");
  });

  it("should update justified block initially", () => {
    const lmd = new StatefulDagLMDGHOST(config);
    lmd.addBlock(1, a, genesis);
    assert(lmd.shouldUpdateJustifiedCheckpoint(a) === true, "should return true")
  });

  it("should update justified block within SAFE_SLOTS_TO_UPDATE_JUSTIFIED", () => {
    const genesisTime = Math.floor(Date.now() / 1000) - (config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED - 1) * config.params.SECONDS_PER_SLOT;
    const lmd = new StatefulDagLMDGHOST(config);
    lmd.start(genesisTime);
    lmd.addBlock(1, a, genesis);
    lmd.addBlock(2, b, a);
    assert(lmd.shouldUpdateJustifiedCheckpoint(b) === true, "should return true");
  });

  /**
   * a -- b
   */
  it("should not update justified block after SAFE_SLOTS_TO_UPDATE_JUSTIFIED - 1", () => {
    const lmd = new StatefulDagLMDGHOST(config);
    lmd.addBlock(1, a, genesis);
    lmd.addBlock(2, b, a, { root: b, epoch: 0 });
    const genesisTime = Math.floor(Date.now() / 1000) - (config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED + 2) * config.params.SECONDS_PER_SLOT;
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
    lmd.addBlock(1, a, genesis);
    lmd.addBlock(2, b, a, { root: b, epoch: 0 });
    lmd.addBlock(3, c, a);
    const genesisTime = Math.floor(Date.now() / 1000) - (config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED + 2) * config.params.SECONDS_PER_SLOT;
    lmd.start(genesisTime);
    // c is a conflicted justified block.
    assert(lmd.shouldUpdateJustifiedCheckpoint(c) === false, "should return false");
  });
});
