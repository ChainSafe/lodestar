import {config} from "@chainsafe/lodestar-config/minimal";
import {altair} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {SyncCommitteeContributionCache} from "../../../src/db/syncCommitteeContribution";
import {generateContributionAndProof} from "../../utils/contributionAndProof";

const NUM_SLOTS_IN_CACHE = 8;

describe("syncCommitteeContribution", function () {
  let cache: SyncCommitteeContributionCache;
  const beaconBlockRoot = Buffer.alloc(32, 1);
  const slot = 10;
  const contributionAndProof: altair.ContributionAndProof = generateContributionAndProof({
    contribution: {slot, beaconBlockRoot},
  });

  beforeEach(() => {
    cache = new SyncCommitteeContributionCache(config);
    cache.add(contributionAndProof);
  });

  it("should find a contribution with same slot + aggregatorIndex + subCommittee", () => {
    const newContributionAndProof = generateContributionAndProof({
      // different beaconBlockRoot
      contribution: {slot, beaconBlockRoot: Buffer.alloc(32)},
    });
    expect(cache.has(newContributionAndProof)).to.be.true;
    newContributionAndProof.aggregatorIndex = contributionAndProof.aggregatorIndex + 1;
    expect(cache.has(newContributionAndProof)).to.be.false;
  });

  it("should return SyncCommitteeContribution list based on same slot and block root", () => {
    const newContributionAndProof = generateContributionAndProof({
      aggregatorIndex: contributionAndProof.aggregatorIndex + 1,
      contribution: {slot, beaconBlockRoot},
    });
    cache.add(newContributionAndProof);
    const aggregate = cache.getSyncAggregate(slot, beaconBlockRoot);
    // TODO Test it's correct. Modify the contributions above so they have 1 bit set to true
    expect(aggregate.syncCommitteeBits.length).to.be.equal(2);
  });

  it("should prune", () => {
    for (let i = 0; i < NUM_SLOTS_IN_CACHE; i++) {
      const newContributionAndProof = generateContributionAndProof({
        contribution: {slot: slot + i + 1, beaconBlockRoot},
      });
      cache.add(newContributionAndProof);
    }
    expect(cache.has(contributionAndProof)).to.be.true;
    cache.prune(99);
    expect(cache.has(contributionAndProof)).to.be.false;
  });
});
