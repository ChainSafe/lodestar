import {altair} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {NUM_SLOTS_IN_CACHE} from "../../../src/db/repositories/utils/syncCommittee";
import {SeenSyncCommitteeContributionCache} from "../../../src/db/seenSyncCommitteeContributionCache";
import {generateContributionAndProof} from "../../utils/contributionAndProof";

describe("SeenSyncCommitteeContributionCache", function () {
  let cache: SeenSyncCommitteeContributionCache;
  const beaconBlockRoot = Buffer.alloc(32, 1);
  const slot = 10;
  const contributionAndProof: altair.ContributionAndProof = generateContributionAndProof({
    contribution: {slot, beaconBlockRoot},
  });

  beforeEach(() => {
    cache = new SeenSyncCommitteeContributionCache();
    cache.addContributionAndProof(contributionAndProof);
  });

  it("should find a contribution with same slot + aggregatorIndex + subCommittee", () => {
    const newContributionAndProof = generateContributionAndProof({
      // different beaconBlockRoot
      contribution: {slot, beaconBlockRoot: Buffer.alloc(32)},
    });
    expect(cache.hasContributionAndProof(newContributionAndProof)).to.be.true;
    newContributionAndProof.aggregatorIndex = contributionAndProof.aggregatorIndex + 1;
    expect(cache.hasContributionAndProof(newContributionAndProof)).to.be.false;
  });

  it("should return SyncCommitteeContribution list based on same slot and block root", () => {
    const newContributionAndProof = generateContributionAndProof({
      aggregatorIndex: contributionAndProof.aggregatorIndex + 1,
      contribution: {slot, beaconBlockRoot},
    });
    cache.addContributionAndProof(newContributionAndProof);
    const contributions = cache.getSyncCommitteeContributions(slot, beaconBlockRoot);
    expect(contributions.length).to.be.equal(2);
    for (const contribution of contributions) {
      expect(contribution.slot).to.be.equal(slot);
      expect(contribution.beaconBlockRoot).to.be.deep.equal(beaconBlockRoot);
    }
  });

  it("should prune", () => {
    for (let i = 0; i < NUM_SLOTS_IN_CACHE; i++) {
      const newContributionAndProof = generateContributionAndProof({
        contribution: {slot: slot + i + 1, beaconBlockRoot},
      });
      cache.addContributionAndProof(newContributionAndProof);
    }
    expect(cache.hasContributionAndProof(contributionAndProof)).to.be.true;
    cache.prune();
    expect(cache.hasContributionAndProof(contributionAndProof)).to.be.false;
  });
});
