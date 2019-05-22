import { assert } from "chai";

import {
  ProgressiveMerkleTree,
  verifyMerkleBranch,
} from "../../../src/util/merkleTree";


describe('util/merkleTree', function() {
  describe('ProgressiveMerkleTree', function() {
    it("can add items", () => {
      const t = new ProgressiveMerkleTree(4);
      let count = 0;
      assert.equal(t.count(), count, `Should have ${count} items`);
      const buf = Buffer.alloc(32);
      for (let i = 1; i < 10; i++) {
        buf[0] = i;
        t.push(buf);
        count++;
        assert.equal(t.count(), count, `Should have ${count} items`);
      }
    });
    it("returns valid proofs", () => {
      const depth = 4;
      const t = new ProgressiveMerkleTree(depth);
      for (let i = 0; i < 10; i++) {
        let buf = Buffer.alloc(32);
        buf[0] = 10;
        const proof = t.push(buf);
        assert(verifyMerkleBranch(buf, proof, depth, t.count() - 1, t.root()));
      }
    });
    it("clones of a tree do not effect the original", () => {
      const depth = 4;
      const t = new ProgressiveMerkleTree(depth);
      const clone = t.clone();
      for (let i = 0; i < 10; i++) {
        let buf = Buffer.alloc(32);
        buf[0] = 10;
        t.push(buf);
      }
      assert(clone.count() === 0);
      assert(t.count() === 10);
      assert(!clone.root().equals(t.root()));
    });
  });
});
