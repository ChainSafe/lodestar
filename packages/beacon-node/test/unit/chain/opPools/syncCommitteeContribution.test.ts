import {BitArray} from "@chainsafe/ssz";
import {describe, it, expect, beforeEach, beforeAll} from "vitest";
import {SecretKey, Signature, fastAggregateVerify} from "@chainsafe/blst";
import {newFilledArray} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
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

describe("chain / opPools / SyncContributionAndProofPool", () => {
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
    expect(ssz.altair.SyncAggregate.equals(aggregate, ssz.altair.SyncAggregate.defaultValue())).toBe(false);
    // TODO Test it's correct. Modify the contributions above so they have 1 bit set to true
    expect(aggregate.syncCommitteeBits.bitLen).toBe(32);
  });
});

describe("replaceIfBetter", () => {
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
    expect(replaceIfBetter(bestContribution, contribution, numParticipants - 1)).toBe(InsertOutcome.NotBetterThan);
  });

  it("same participants", () => {
    const contribution = ssz.altair.SyncCommitteeContribution.defaultValue();
    expect(replaceIfBetter(bestContribution, contribution, numParticipants)).toBe(InsertOutcome.NotBetterThan);
  });

  it("more participants", () => {
    const contribution = ssz.altair.SyncCommitteeContribution.defaultValue();
    const numParticipantsNew = numParticipants + 1;

    expect(replaceIfBetter(bestContribution, contribution, numParticipantsNew)).toBe(InsertOutcome.NewData);
    expect(renderBitArray(bestContribution.syncSubcommitteeBits)).toEqual(renderBitArray(contribution.aggregationBits));
    expect(bestContribution.numParticipants).toBe(numParticipantsNew);
  });
});

describe("aggregate", () => {
  const sks: SecretKey[] = [];
  let bestContributionBySubnet: Map<number, SyncContributionFast>;
  beforeAll(async () => {
    for (let i = 0; i < SYNC_COMMITTEE_SUBNET_COUNT; i++) {
      sks.push(SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
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
      expect(renderBitArray(syncAggregate.syncCommitteeBits)).toEqual(
        renderBitArray(BitArray.fromBoolArray(expectSyncCommittees))
      );
      expect(
        fastAggregateVerify(
          blockRoot,
          testSks.map((sk) => sk.toPublicKey()),
          Signature.fromBytes(syncAggregate.syncCommitteeSignature)
        )
      ).toBe(true);
    });
  }
});
