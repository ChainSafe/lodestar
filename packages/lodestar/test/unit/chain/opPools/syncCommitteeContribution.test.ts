import {altair, ssz} from "@chainsafe/lodestar-types";
import {initBLS} from "@chainsafe/lodestar-cli/src/util";
import {newFilledArray} from "@chainsafe/lodestar-beacon-state-transition";

import {SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {expect} from "chai";
import {
  aggregate,
  contributionToFast,
  replaceIfBetter,
  SyncContributionAndProofPool,
  SyncContributionFast,
} from "../../../../src/chain/opPools/syncContributionAndProofPool";
import {generateContributionAndProof, generateEmptyContribution} from "../../../utils/contributionAndProof";
import {InsertOutcome} from "../../../../src/chain/opPools/types";
import bls, {SecretKey} from "@chainsafe/bls";

describe("chain / opPools / SyncContributionAndProofPool", function () {
  let cache: SyncContributionAndProofPool;
  const beaconBlockRoot = Buffer.alloc(32, 1);
  const slot = 10;
  const syncCommitteeParticipants = 0;
  const contributionAndProof: altair.ContributionAndProof = generateContributionAndProof({
    contribution: {slot, beaconBlockRoot},
  });

  beforeEach(() => {
    cache = new SyncContributionAndProofPool();
    cache.add(contributionAndProof, syncCommitteeParticipants);
  });

  it("should return SyncCommitteeContribution list based on same slot and block root", () => {
    const newContributionAndProof = generateContributionAndProof({
      aggregatorIndex: contributionAndProof.aggregatorIndex + 1,
      contribution: {slot, beaconBlockRoot},
    });
    cache.add(newContributionAndProof, syncCommitteeParticipants);
    const aggregate = cache.getAggregate(slot, beaconBlockRoot);
    expect(ssz.altair.SyncAggregate.equals(aggregate, ssz.altair.SyncAggregate.defaultValue())).to.be.false;
    // TODO Test it's correct. Modify the contributions above so they have 1 bit set to true
    expect(aggregate.syncCommitteeBits.length).to.be.equal(32);
  });
});

describe("replaceIfBetter", function () {
  let bestContribution: SyncContributionFast;
  // const subnetSize = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);
  beforeEach(() => {
    bestContribution = {
      syncSubcommitteeBits: [true, true, false, false, false, false, false, false],
      numParticipants: 2,
      syncSubcommitteeSignature: new Uint8Array(0),
    };
  });
  it("less participants", () => {
    const contribution = generateEmptyContribution();
    contribution.aggregationBits[0] = true;
    expect(replaceIfBetter(bestContribution, contribution, 0)).to.be.equal(
      InsertOutcome.NotBetterThan,
      "less participant item should not replace the best contribution"
    );
  });

  it("same participants", () => {
    const contribution = generateEmptyContribution();
    contribution.aggregationBits[0] = true;
    contribution.aggregationBits[7] = true;
    expect(replaceIfBetter(bestContribution, contribution, 2)).to.be.equal(
      InsertOutcome.NotBetterThan,
      "same participant item should not replace the best contribution"
    );
  });

  it("more participants", () => {
    const contribution = generateEmptyContribution();
    contribution.aggregationBits[3] = true;
    contribution.aggregationBits[4] = true;
    contribution.aggregationBits[5] = true;
    expect(replaceIfBetter(bestContribution, contribution, 3)).to.be.equal(
      InsertOutcome.NewData,
      "more participant item should replace the best contribution"
    );
    expect(bestContribution.syncSubcommitteeBits).to.be.deep.equal(
      [false, false, false, true, true, true, false, false],
      "incorect subcommittees"
    );
    expect(bestContribution.numParticipants).to.be.equal(3, "incorrect numParticipants");
  });
});

describe("contributionToFast", function () {
  let sk1: SecretKey;
  before(async () => {
    await initBLS();
    sk1 = bls.SecretKey.fromBytes(Buffer.alloc(32, 1));
  });

  it("convert a contribution to SyncContributionFast", () => {
    const contribution = generateEmptyContribution();
    contribution.aggregationBits[3] = true;
    contribution.aggregationBits[4] = true;
    contribution.aggregationBits[5] = true;
    contribution.signature = sk1.sign(Buffer.alloc(32)).toBytes();
    const fast = contributionToFast(contribution, 3);
    expect(fast.syncSubcommitteeBits).to.be.deep.equal(
      [false, false, false, true, true, true, false, false],
      "incorect subcommittees"
    );
    expect(fast.numParticipants).to.be.equal(3, "incorrect numParticipants");
    // no need to check sygnature
  });
});

describe("aggregate", function () {
  const sks: SecretKey[] = [];
  let bestContributionBySubnet: Map<number, SyncContributionFast>;
  before(async () => {
    await initBLS();
    for (let i = 0; i < SYNC_COMMITTEE_SUBNET_COUNT; i++) {
      sks.push(bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    }
    bestContributionBySubnet = new Map<number, SyncContributionFast>();
  });

  const numSubnets = [1, 2, 3, 4];
  for (const numSubnet of numSubnets) {
    it(`should aggregate best contributions from ${numSubnet} subnets`, () => {
      const blockRoot = Buffer.alloc(32, 10);
      const testSks: SecretKey[] = [];
      for (let subnet = 0; subnet < numSubnet; subnet++) {
        bestContributionBySubnet.set(subnet, {
          // first participation of each subnet is true
          syncSubcommitteeBits: [true, false, false, false, false, false, false, false],
          numParticipants: 1,
          syncSubcommitteeSignature: sks[subnet].sign(blockRoot).toBytes(),
        });
        testSks.push(sks[subnet]);
      }
      const syncAggregate = aggregate(bestContributionBySubnet);
      const expectSyncCommittees = newFilledArray(SYNC_COMMITTEE_SIZE, false);
      for (let subnet = 0; subnet < numSubnet; subnet++) {
        // first participation of each subnet is true
        expectSyncCommittees[subnet * 8] = true;
      }
      expect(syncAggregate.syncCommitteeBits).to.be.deep.equal(expectSyncCommittees, "incorrect sync committees");
      expect(
        bls.verifyAggregate(
          testSks.map((sk) => sk.toPublicKey().toBytes()),
          blockRoot,
          syncAggregate.syncCommitteeSignature.valueOf() as Uint8Array
        )
      ).to.be.equal(true, "invalid aggregated signature");
    });
  }
});
