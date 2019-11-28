import {assert} from "chai";

import {StatefulDagLMDGHOST} from "../../../../src/chain/forkChoice/statefulDag/lmdGhost";

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
    const lmd = new StatefulDagLMDGHOST();
    lmd.addBlock(1, a, genesis);
    lmd.setFinalized(a);
    lmd.setJustified(a);
    lmd.addBlock(2, b, a);
    lmd.addBlock(3, c, b);
    lmd.addBlock(3, d, b);
    lmd.addBlock(3, e, b);
    lmd.addBlock(4, f, c);
    const head = lmd.head();
    assert(head.equals(f));
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
    const lmd = new StatefulDagLMDGHOST();
    let head;
    lmd.addBlock(1, a, genesis);
    lmd.setFinalized(a);
    lmd.setJustified(a);
    lmd.addBlock(2, b, a);
    lmd.addBlock(3, c, b);
    lmd.addBlock(3, d, b);
    lmd.addBlock(3, e, b);
    lmd.addBlock(4, f, c);
    // add vote to e
    lmd.addAttestation(e, 1, 3n);
    head = lmd.head();
    assert(head.equals(e), "head should be e");
    // recast e vote to f
    lmd.addAttestation(f, 1, 3n);
    head = lmd.head();
    assert(head.equals(f), "head should be f");
    // add vote to d
    lmd.addAttestation(d, 2, 5n);
    head = lmd.head();
    assert(head.equals(d), "head should be d");
    // add g block
    lmd.addBlock(4, g, d);
    head = lmd.head();
    assert(head.equals(g), "head should be g");
    // add vote to c
    lmd.addAttestation(c, 3, 2n);
    head = lmd.head();
    assert(head.equals(g), "head should be g");
    // add vote to c
    lmd.addAttestation(c, 4, 1n);
    head = lmd.head();
    assert(head.equals(f), "head should be f");
    // recast co vote to g
    lmd.addAttestation(g, 3, 1n);
    head = lmd.head();
    assert(head.equals(g), "head should be g");
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
    const lmd = new StatefulDagLMDGHOST();
    let head;
    lmd.addBlock(1, a, genesis);
    lmd.setFinalized(a);
    lmd.setJustified(a);
    lmd.addBlock(2, b, a);
    lmd.addBlock(3, c, b);
    lmd.addBlock(4, d, c);
    lmd.addBlock(5, e, d);
    lmd.addBlock(2, f, a);
    lmd.addBlock(3, g, f);
    lmd.addAttestation(e, 1, 3n);
    head = lmd.head();
    assert(head.equals(e), "head should be e");
    lmd.addAttestation(g, 2, 4n);
    head = lmd.head();
    assert(head.equals(g), "head should be g");
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
    const lmd = new StatefulDagLMDGHOST();
    let head;
    lmd.addBlock(1, a, genesis);
    lmd.setFinalized(a);
    lmd.setJustified(a);
    lmd.addBlock(2, b, a);
    lmd.addBlock(3, c, a);
    lmd.addBlock(4, d, b);
    lmd.addBlock(5, e, b);
    lmd.addBlock(2, f, c);
    lmd.addBlock(3, g, c);
    lmd.addAttestation(e, 1, 3n);
    head = lmd.head();
    assert(head.equals(e), "head should be e");
    lmd.addAttestation(g, 2, 4n);
    head = lmd.head();
    assert(head.equals(g), "head should be g");
  });
});
