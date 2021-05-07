import {bls, init} from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/minimal";
import {altair} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import {NUM_SLOTS_IN_CACHE} from "../../../src/db/repositories/utils/syncCommittee";
import {SeenSyncCommitteeCache} from "../../../src/db/seenSyncCommitteeCache";
import {generateSyncCommitteeSignature} from "../../utils/syncCommittee";

describe("SeenSyncCommitteeCache", function () {
  let cache: SeenSyncCommitteeCache;
  const subCommitteeIndex = 2;
  const indicesInSubSyncCommittee = [4, 5];
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
    cache = new SeenSyncCommitteeCache(config);
    cache.addSyncCommitteeSignature(subCommitteeIndex, syncCommittee, indicesInSubSyncCommittee);
  });

  it("should find a sync committee based on same slot and validator index", () => {
    const newSyncCommittee = generateSyncCommitteeSignature({
      // different beaconBlockRoot
      slot,
      validatorIndex: 2000,
    });
    expect(cache.hasSyncCommitteeSignature(subCommitteeIndex, newSyncCommittee)).to.be.true;
    expect(cache.hasSyncCommitteeSignature(subCommitteeIndex + 1, newSyncCommittee)).to.be.false;
    newSyncCommittee.slot++;
    expect(cache.hasSyncCommitteeSignature(subCommitteeIndex, newSyncCommittee)).to.be.false;
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
    cache.addSyncCommitteeSignature(subCommitteeIndex, newSyncCommittee, newIndicesInSubSyncCommittee);
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
      const newIndices = [...newIndicesInSubSyncCommittee, ...indicesInSubSyncCommittee];
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
      cache.addSyncCommitteeSignature(subCommitteeIndex, newSyncCommittee, [6]);
    }
    expect(cache.hasSyncCommitteeSignature(subCommitteeIndex, syncCommittee)).to.be.true;
    cache.prune();
    expect(cache.hasSyncCommitteeSignature(subCommitteeIndex, syncCommittee)).to.be.false;
  });
});
