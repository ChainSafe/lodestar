import {bls, init} from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/default";
import {altair} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import {SyncCommitteeCache} from "../../../src/db/syncCommittee";
import {generateSyncCommitteeSignature} from "../../utils/syncCommittee";

const NUM_SLOTS_IN_CACHE = 3;

describe("SyncCommitteeCache", function () {
  let cache: SyncCommitteeCache;
  const subCommitteeIndex = 2;
  const indexInSubCommittee = 3;
  const beaconBlockRoot = Buffer.alloc(32, 1);
  const slot = 10;
  let syncCommittee: altair.SyncCommitteeSignature;

  before("Init BLS", async () => {
    await init("blst-native");
    const sk = bls.SecretKey.fromBytes(Buffer.alloc(32, 1));
    syncCommittee = generateSyncCommitteeSignature({
      slot,
      beaconBlockRoot,
      validatorIndex: 2000,
      signature: sk.sign(beaconBlockRoot).toBytes(),
    });
  });

  beforeEach(() => {
    cache = new SyncCommitteeCache(config);
    cache.add(subCommitteeIndex, syncCommittee, indexInSubCommittee);
  });

  it("should find a sync committee based on same slot and validator index", () => {
    const newSyncCommittee = generateSyncCommitteeSignature({
      // different beaconBlockRoot
      slot,
      validatorIndex: 2000,
    });
    expect(cache.has(subCommitteeIndex, newSyncCommittee)).to.be.true;
    expect(cache.has(subCommitteeIndex + 1, newSyncCommittee)).to.be.false;
    newSyncCommittee.slot++;
    expect(cache.has(subCommitteeIndex, newSyncCommittee)).to.be.false;
  });

  it("should preaggregate SyncCommitteeContribution", () => {
    let contribution = cache.getSyncCommitteeContribution(
      subCommitteeIndex,
      syncCommittee.slot,
      syncCommittee.beaconBlockRoot
    );
    expect(contribution).to.be.not.null;
    const newSecretKey = bls.SecretKey.fromBytes(Buffer.alloc(32, 2));
    const newSyncCommittee = generateSyncCommitteeSignature({
      slot: syncCommittee.slot,
      beaconBlockRoot,
      // different validatorIndex
      validatorIndex: syncCommittee.validatorIndex + 1,
      signature: newSecretKey.sign(beaconBlockRoot).toBytes(),
    });
    const newIndicesInSubSyncCommittee = [1];
    cache.add(subCommitteeIndex, newSyncCommittee, newIndicesInSubSyncCommittee[0]);
    contribution = cache.getSyncCommitteeContribution(
      subCommitteeIndex,
      syncCommittee.slot,
      syncCommittee.beaconBlockRoot
    );
    expect(contribution).to.be.not.null;
    if (contribution) {
      expect(contribution.slot).to.be.equal(syncCommittee.slot);
      expect(toHexString(contribution.beaconBlockRoot)).to.be.equal(toHexString(syncCommittee.beaconBlockRoot));
      expect(contribution.subCommitteeIndex).to.be.equal(subCommitteeIndex);
      const newIndices = [...newIndicesInSubSyncCommittee, indexInSubCommittee];
      const aggregationBits = contribution.aggregationBits;
      for (let index = 0; index < aggregationBits.length; index++) {
        if (newIndices.includes(index)) {
          expect(aggregationBits[index]).to.be.true;
        } else {
          expect(aggregationBits[index]).to.be.false;
        }
      }
    }
  });

  it("should prune", () => {
    for (let i = 0; i < NUM_SLOTS_IN_CACHE; i++) {
      const newSyncCommittee = {...syncCommittee};
      newSyncCommittee.slot = syncCommittee.slot + i + 1;
      cache.add(subCommitteeIndex, newSyncCommittee, indexInSubCommittee);
    }
    expect(cache.has(subCommitteeIndex, syncCommittee)).to.be.true;
    cache.prune(99);
    expect(cache.has(subCommitteeIndex, syncCommittee)).to.be.false;
  });
});
