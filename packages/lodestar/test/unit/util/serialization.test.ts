import {describe, it} from "mocha";
import {MerkleTreeSerialization} from "../../../src/util/serialization";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {expect} from "chai";
import {ProgressiveMerkleTree} from "@chainsafe/eth2.0-utils";

describe("merkle tree serialization", function () {

  it("round trip works", function () {
    const serialization = new MerkleTreeSerialization(config);
    const tree = ProgressiveMerkleTree.empty(4, serialization);
    const result = serialization.deserializeTree(serialization.serializeTree(tree.toObject()));
    expect(result).to.be.deep.equal(tree.toObject());
  });

  it("length serialization works", function () {
    const serialization = new MerkleTreeSerialization(config);
    const serialized = serialization.serializeLength(32);
    expect(serialized.length).to.be.greaterThan(0);
  });

});