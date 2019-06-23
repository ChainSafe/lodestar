import { assert, expect } from "chai";

import {
  ProgressiveMerkleTree,
  verifyMerkleBranch,
} from "../../../src/util/merkleTree";
import {deserialize} from "@chainsafe/ssz";
import {MerkleTree} from "../../../src/types";


describe('util/merkleTree', function() {
  describe('ProgressiveMerkleTree', function() {
    it("can push items", () => {
      const t = ProgressiveMerkleTree.empty(4);
      const buf = Buffer.alloc(32);
      for (let i = 1; i < 10; i++) {
        buf[0] = i;
        t.push(buf);
      }
      expect(true).true;
    });

    it("can add items", () => {
      const t = ProgressiveMerkleTree.empty(4);
      const buf = Buffer.alloc(32);
      for (let i = 1; i < 10; i++) {
        buf[0] = i;
        t.add(i, buf);
      }
      expect(true).true;
    });

    it("returns valid proofs", () => {
      const depth = 4;
      const t = ProgressiveMerkleTree.empty(depth);
      for (let i = 0; i < 10; i++) {
        let buf = Buffer.alloc(32, i);
        t.push(buf);
      }

      for (let i = 0; i < 10; i++) {
        assert(verifyMerkleBranch(Buffer.alloc(32, i), t.getProof(i), depth, i, t.root()));
      }
    });


    it("is able to serialize and recreate", () => {
      const depth = 4;
      const t = ProgressiveMerkleTree.empty(depth);
      for (let i = 0; i < 10; i++) {
        let buf = Buffer.alloc(32);
        buf[0] = 10;
        t.push(buf);
      }
      const rootBefore = t.root();
      const serialized = t.serialize();
      const t2 = ProgressiveMerkleTree.fromObject(deserialize(serialized, MerkleTree));
      expect(t2.root()).to.be.deep.equal(rootBefore);
    });
  });
});
