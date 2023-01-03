import {expect} from "chai";
import {ssz} from "@lodestar/types";
import {newFilledArray} from "@lodestar/state-transition";
import type {SecretKey} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";
import {BitArray} from "@chainsafe/ssz";
import {SYNC_COMMITTEE_SIZE, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {
  aggregate,
  replaceIfBetter,
  SyncContributionAndProofPool,
  SyncContributionFast,
} from "../../../../src/chain/opPools/syncContributionAndProofPool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";
import {EMPTY_SIGNATURE} from "../../../../src/constants/index.js";
import {renderBitArray} from "../../../utils/render.js";
import {VALID_BLS_SIGNATURE_RAND} from "../../../utils/typeGenerator.js";

describe("chain / opPools / SyncContributionAndProofPool", function () {
  let cache: SyncContributionAndProofPool;
  const beaconBlockRoot = Buffer.alloc(32, 1);
  const slot = 10;
  const syncCommitteeParticipants = 0;
  const contributionAndProof = ssz.altair.ContributionAndProof.defaultValue();
  contributionAndProof.contribution.slot = slot;
  contributionAndProof.contribution.beaconBlockRoot = beaconBlockRoot;
  contributionAndProof.contribution.signature = VALID_BLS_SIGNATURE_RAND;

  beforeEach(() => {
    cache = new SyncContributionAndProofPool();
    cache.add(contributionAndProof, syncCommitteeParticipants);
  });

  it("should return SyncCommitteeContribution list based on same slot and block root", () => {
    const newContributionAndProof = ssz.altair.ContributionAndProof.defaultValue();
    newContributionAndProof.aggregatorIndex = contributionAndProof.aggregatorIndex + 1;
    newContributionAndProof.contribution.slot = slot;
    newContributionAndProof.contribution.beaconBlockRoot = beaconBlockRoot;

    cache.add(newContributionAndProof, syncCommitteeParticipants);
    const aggregate = cache.getAggregate(slot, beaconBlockRoot);
    expect(ssz.altair.SyncAggregate.equals(aggregate, ssz.altair.SyncAggregate.defaultValue())).to.equal(false);
    // TODO Test it's correct. Modify the contributions above so they have 1 bit set to true
    expect(aggregate.syncCommitteeBits.bitLen).to.be.equal(32);
  });
});

describe("replaceIfBetter", function () {
  const numParticipants = 2;
  let bestContribution: SyncContributionFast;
  // const subnetSize = Math.floor(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);
  beforeEach(() => {
    bestContribution = {
      syncSubcommitteeBits: BitArray.fromBoolArray([true, true, false, false, false, false, false, false]),
      numParticipants,
      syncSubcommitteeSignature: EMPTY_SIGNATURE,
    };
  });

  it("less participants", () => {
    const contribution = ssz.altair.SyncCommitteeContribution.defaultValue();
    contribution.aggregationBits.set(0, true);
    expect(replaceIfBetter(bestContribution, contribution, numParticipants - 1)).to.be.equal(
      InsertOutcome.NotBetterThan,
      "less participant item should not replace the best contribution"
    );
  });

  it("same participants", () => {
    const contribution = ssz.altair.SyncCommitteeContribution.defaultValue();
    expect(replaceIfBetter(bestContribution, contribution, numParticipants)).to.be.equal(
      InsertOutcome.NotBetterThan,
      "same participant item should not replace the best contribution"
    );
  });

  it("more participants", () => {
    const contribution = ssz.altair.SyncCommitteeContribution.defaultValue();
    const numParticipantsNew = numParticipants + 1;

    expect(replaceIfBetter(bestContribution, contribution, numParticipantsNew)).to.be.equal(
      InsertOutcome.NewData,
      "more participant item should replace the best contribution"
    );
    expect(renderBitArray(bestContribution.syncSubcommitteeBits)).to.be.deep.equal(
      renderBitArray(contribution.aggregationBits),
      "incorect subcommittees"
    );
    expect(bestContribution.numParticipants).to.be.equal(numParticipantsNew, "incorrect numParticipants");
  });
});

describe("aggregate", function () {
  const sks: SecretKey[] = [];
  let bestContributionBySubnet: Map<number, SyncContributionFast>;
  before(async () => {
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
          syncSubcommitteeBits: BitArray.fromBoolArray([true, false, false, false, false, false, false, false]),
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
      expect(renderBitArray(syncAggregate.syncCommitteeBits)).to.be.deep.equal(
        renderBitArray(BitArray.fromBoolArray(expectSyncCommittees)),
        "incorrect sync committees"
      );
      expect(
        bls.verifyAggregate(
          testSks.map((sk) => sk.toPublicKey().toBytes()),
          blockRoot,
          syncAggregate.syncCommitteeSignature
        )
      ).to.be.equal(true, "invalid aggregated signature");
    });
  }
});
