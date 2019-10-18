import {describe, it} from "mocha";
import {IReputation} from "../../../../src/sync/IReputation";
import {Epoch} from "@chainsafe/eth2.0-types";
import {getTargetEpoch} from "../../../../src/sync/utils/sync";
import {expect} from "chai";

describe("sync utils", function () {
   
  it("should obtain target epoch", function () {
    const peers: IReputation[] = [
      generateReputation(3),
      generateReputation(1),
      generateReputation(2),
    ];
    const result = getTargetEpoch(peers, {epoch: 0, root: Buffer.alloc(0)});
    expect(result).to.be.equal(1);
    const result1 = getTargetEpoch(peers, {epoch: 2, root: Buffer.alloc(0)});
    expect(result1).to.be.equal(3);
    const result2 = getTargetEpoch(peers, {epoch: 3, root: Buffer.alloc(0)});
    expect(result2).to.be.equal(3);
  });

  it("should obtain target epoch with incomplete hello statuses", function () {
    const peers: IReputation[] = [
      {
        latestHello: null,
        score: 1
      },
      generateReputation(1),
      generateReputation(2),
    ];
    const result = getTargetEpoch(peers, {epoch: 0, root: Buffer.alloc(0)});
    expect(result).to.be.equal(1);
  });

  it("should return given epoch if no peers", function () {
    const peers: IReputation[] = [
    ];
    const result = getTargetEpoch(peers, {epoch: 0, root: Buffer.alloc(0)});
    expect(result).to.be.equal(0);
  });
    
});


function generateReputation(finalizedEpoch: Epoch): IReputation {
  return {
    score: 1,
    latestHello: {
      finalizedEpoch: finalizedEpoch || 0,
      finalizedRoot: Buffer.alloc(1),
      headForkVersion: Buffer.alloc(4),
      headRoot: Buffer.alloc(1),
      headSlot: 0
    }
  };
}