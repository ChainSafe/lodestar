import {expect} from "chai";
import bls from "@chainsafe/bls";
import {altair} from "@lodestar/types";
import {toHexString} from "@chainsafe/ssz";
import {SyncCommitteeMessagePool} from "../../../../src/chain/opPools/index.js";

describe("chain / opPools / SyncCommitteeMessagePool", function () {
  let cache: SyncCommitteeMessagePool;
  const subcommitteeIndex = 2;
  const indexInSubcommittee = 3;
  const beaconBlockRoot = Buffer.alloc(32, 1);
  const slot = 10;
  let syncCommittee: altair.SyncCommitteeMessage;

  before("Init BLS", async () => {
    const sk = bls.SecretKey.fromBytes(Buffer.alloc(32, 1));
    syncCommittee = {
      slot,
      beaconBlockRoot,
      validatorIndex: 2000,
      signature: sk.sign(beaconBlockRoot).toBytes(),
    };
  });

  beforeEach(() => {
    cache = new SyncCommitteeMessagePool();
    cache.add(subcommitteeIndex, syncCommittee, indexInSubcommittee);
  });

  it("should preaggregate SyncCommitteeContribution", () => {
    let contribution = cache.getContribution(subcommitteeIndex, syncCommittee.slot, syncCommittee.beaconBlockRoot);
    expect(contribution).to.be.not.null;
    const newSecretKey = bls.SecretKey.fromBytes(Buffer.alloc(32, 2));
    const newSyncCommittee: altair.SyncCommitteeMessage = {
      slot: syncCommittee.slot,
      beaconBlockRoot,
      // different validatorIndex
      validatorIndex: syncCommittee.validatorIndex + 1,
      signature: newSecretKey.sign(beaconBlockRoot).toBytes(),
    };
    const newIndicesInSubSyncCommittee = [1];
    cache.add(subcommitteeIndex, newSyncCommittee, newIndicesInSubSyncCommittee[0]);
    contribution = cache.getContribution(subcommitteeIndex, syncCommittee.slot, syncCommittee.beaconBlockRoot);
    expect(contribution).to.be.not.null;
    if (contribution) {
      expect(contribution.slot).to.be.equal(syncCommittee.slot);
      expect(toHexString(contribution.beaconBlockRoot)).to.be.equal(toHexString(syncCommittee.beaconBlockRoot));
      expect(contribution.subcommitteeIndex).to.be.equal(subcommitteeIndex);
      const newIndices = [...newIndicesInSubSyncCommittee, indexInSubcommittee];
      const aggregationBits = contribution.aggregationBits;
      for (let index = 0; index < aggregationBits.bitLen; index++) {
        expect(aggregationBits.get(index)).to.equal(newIndices.includes(index), `Wrong bit value index ${index}`);
      }
    }
  });
});
