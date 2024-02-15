import type {SecretKey} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";
import {BitArray, fromHexString, toHexString} from "@chainsafe/ssz";
import {describe, it, expect, beforeEach, beforeAll, afterEach, vi} from "vitest";
import {CachedBeaconStateAllForks, newFilledArray} from "@lodestar/state-transition";
import {FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz, phase0} from "@lodestar/types";
import {CachedBeaconStateAltair} from "@lodestar/state-transition/src/types.js";
import {MockedForkChoice, getMockedForkChoice} from "../../../mocks/mockedBeaconChain.js";
import {
  AggregatedAttestationPool,
  aggregateInto,
  getNotSeenValidatorsFn,
  MatchingDataAttestationGroup,
} from "../../../../src/chain/opPools/aggregatedAttestationPool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";
import {linspace} from "../../../../src/util/numpy.js";
import {generateCachedAltairState} from "../../../utils/state.js";
import {renderBitArray} from "../../../utils/render.js";
import {ZERO_HASH_HEX} from "../../../../src/constants/constants.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";
import {generateValidators} from "../../../utils/validator.js";

/** Valid signature of random data to prevent BLS errors */
const validSignature = fromHexString(
  "0xb2afb700f6c561ce5e1b4fedaec9d7c06b822d38c720cf588adfda748860a940adf51634b6788f298c552de40183b5a203b2bbe8b7dd147f0bb5bc97080a12efbb631c8888cb31a99cc4706eb3711865b8ea818c10126e4d818b542e9dbf9ae8"
);

describe("AggregatedAttestationPool", function () {
  let pool: AggregatedAttestationPool;
  const altairForkEpoch = 2020;
  const currentEpoch = altairForkEpoch + 10;
  const currentSlot = SLOTS_PER_EPOCH * currentEpoch;

  const committeeIndex = 0;
  const attestation = ssz.phase0.Attestation.defaultValue();
  attestation.data.slot = currentSlot;
  attestation.data.index = committeeIndex;
  attestation.data.target.epoch = currentEpoch;
  const attDataRootHex = toHexString(ssz.phase0.AttestationData.hashTreeRoot(attestation.data));

  const validatorOpts = {
    activationEpoch: 0,
    effectiveBalance: MAX_EFFECTIVE_BALANCE,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
    exitEpoch: FAR_FUTURE_EPOCH,
  };
  // this makes a committee length of 4
  const vc = 64;
  const committeeLength = 4;
  const validators = generateValidators(vc, validatorOpts);
  const originalState = generateCachedAltairState({slot: currentSlot + 1, validators}, altairForkEpoch);
  const committee = originalState.epochCtx.getBeaconCommittee(currentSlot, committeeIndex);
  expect(committee.length).toEqual(committeeLength);
  // 0 and 1 in committee are fully participated
  const epochParticipation = newFilledArray(vc, 0b111);
  for (let i = 0; i < committeeLength; i++) {
    if (i === 0 || i === 1) {
      epochParticipation[committee[i]] = 0b111;
    } else {
      epochParticipation[committee[i]] = 0b000;
    }
  }
  (originalState as unknown as CachedBeaconStateAltair).previousEpochParticipation =
    ssz.altair.EpochParticipation.toViewDU(epochParticipation);
  (originalState as unknown as CachedBeaconStateAltair).currentEpochParticipation =
    ssz.altair.EpochParticipation.toViewDU(epochParticipation);
  originalState.commit();
  let altairState: CachedBeaconStateAllForks;

  let forkchoiceStub: MockedForkChoice;

  beforeEach(() => {
    pool = new AggregatedAttestationPool();
    altairState = originalState.clone();
    forkchoiceStub = getMockedForkChoice();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("getParticipationFn", () => {
    // previousEpochParticipation and currentEpochParticipation is created inside generateCachedState
    // 0 and 1 are fully participated
    const notSeenValidatorFn = getNotSeenValidatorsFn(altairState);
    const participation = notSeenValidatorFn(currentEpoch, committee);
    // seen attesting indices are 0, 1 => not seen are 2, 3
    expect(participation).toEqual(
      // {
      // validatorIndices: [null, null, committee[2], committee[3]],
      // attestingIndices: new Set([2, 3]),
      // }
      new Set([2, 3])
    );
  });

  // previousEpochParticipation and currentEpochParticipation is created inside generateCachedState
  // 0 and 1 are fully participated
  const testCases: {name: string; attestingBits: number[]; isReturned: boolean}[] = [
    {name: "all validators are seen", attestingBits: [0b00000011], isReturned: false},
    {name: "all validators are NOT seen", attestingBits: [0b00001100], isReturned: true},
    {name: "one is seen and one is NOT", attestingBits: [0b00001101], isReturned: true},
  ];

  for (const {name, attestingBits, isReturned} of testCases) {
    it(name, function () {
      const aggregationBits = new BitArray(new Uint8Array(attestingBits), committeeLength);
      pool.add(
        {...attestation, aggregationBits},
        attDataRootHex,
        aggregationBits.getTrueBitIndexes().length,
        committee
      );
      forkchoiceStub.getBlockHex.mockReturnValue(generateProtoBlock());
      forkchoiceStub.getDependentRoot.mockReturnValue(ZERO_HASH_HEX);
      if (isReturned) {
        expect(pool.getAttestationsForBlock(forkchoiceStub, altairState).length).toBeGreaterThan(0);
      } else {
        expect(pool.getAttestationsForBlock(forkchoiceStub, altairState).length).toEqual(0);
      }
      // "forkchoice should be called to check pivot block"
      expect(forkchoiceStub.getDependentRoot).toHaveBeenCalledTimes(1);
    });
  }

  it("incorrect source", function () {
    altairState.currentJustifiedCheckpoint.epoch = 1000;
    // all attesters are not seen
    const attestingIndices = [2, 3];
    pool.add(attestation, attDataRootHex, attestingIndices.length, committee);
    expect(pool.getAttestationsForBlock(forkchoiceStub, altairState)).toEqual([]);
    // "forkchoice should not be called"
    expect(forkchoiceStub.iterateAncestorBlocks).not.toHaveBeenCalledTimes(1);
  });

  it("incompatible shuffling - incorrect pivot block root", function () {
    // all attesters are not seen
    const attestingIndices = [2, 3];
    pool.add(attestation, attDataRootHex, attestingIndices.length, committee);
    forkchoiceStub.getBlockHex.mockReturnValue(generateProtoBlock());
    forkchoiceStub.getDependentRoot.mockReturnValue("0xWeird");
    expect(pool.getAttestationsForBlock(forkchoiceStub, altairState)).toEqual([]);
    // "forkchoice should be called to check pivot block"
    expect(forkchoiceStub.getDependentRoot).toHaveBeenCalledTimes(1);
  });
});

describe("MatchingDataAttestationGroup.add()", () => {
  const testCases: {id: string; attestationsToAdd: {bits: number[]; res: InsertOutcome; isKept: boolean}[]}[] = [
    {
      id: "2 intersecting",
      attestationsToAdd: [
        {bits: [0b11111100], res: InsertOutcome.NewData, isKept: true},
        {bits: [0b00111111], res: InsertOutcome.NewData, isKept: true},
      ],
    },
    {
      id: "New is superset",
      attestationsToAdd: [
        {bits: [0b11111100], res: InsertOutcome.NewData, isKept: false},
        {bits: [0b11111111], res: InsertOutcome.NewData, isKept: true},
      ],
    },
    {
      id: "New is subset",
      attestationsToAdd: [
        {bits: [0b11111111], res: InsertOutcome.NewData, isKept: true},
        {bits: [0b11111100], res: InsertOutcome.AlreadyKnown, isKept: false},
      ],
    },
    {
      id: "Aggregated",
      attestationsToAdd: [
        // Attestation 0 is kept because it's mutated in place to aggregate attestation 1
        {bits: [0b00001111], res: InsertOutcome.NewData, isKept: true},
        {bits: [0b11110000], res: InsertOutcome.Aggregated, isKept: false},
      ],
      // Corectly aggregating the resulting att is checked in "MatchingDataAttestationGroup aggregateInto" test
    },
  ];

  const attestationData = ssz.phase0.AttestationData.defaultValue();
  const committee = linspace(0, 7);

  for (const {id, attestationsToAdd} of testCases) {
    it(id, () => {
      const attestationGroup = new MatchingDataAttestationGroup(committee, attestationData);

      const attestations = attestationsToAdd.map(
        ({bits}): phase0.Attestation => ({
          data: attestationData,
          aggregationBits: new BitArray(new Uint8Array(bits), 8),
          signature: validSignature,
        })
      );

      const results = attestations.map((attestation) =>
        attestationGroup.add({attestation, trueBitsCount: attestation.aggregationBits.getTrueBitIndexes().length})
      );

      expect(results).toEqual(attestationsToAdd.map((e) => e.res));

      const attestationsAfterAdding = attestationGroup.getAttestations();

      for (const [i, {isKept}] of attestationsToAdd.entries()) {
        if (isKept) {
          expect(attestationsAfterAdding.indexOf(attestations[i])).toBeGreaterThanOrEqual(0);
        } else {
          expect(attestationsAfterAdding.indexOf(attestations[i])).toEqual(-1);
        }
      }
    });
  }
});

describe("MatchingDataAttestationGroup.getAttestationsForBlock", () => {
  const testCases: {
    id: string;
    notSeenAttestingBits: number[];
    attestationsToAdd: {bits: number[]; notSeenAttesterCount: number}[];
  }[] = [
    // Note: attestationsToAdd MUST intersect in order to not be aggregated and distort the results
    {
      id: "All have attested",
      // same to seenAttestingBits: [0b11111111],
      notSeenAttestingBits: [0b00000000],
      attestationsToAdd: [
        {bits: [0b11111110], notSeenAttesterCount: 0},
        {bits: [0b00000011], notSeenAttesterCount: 0},
      ],
    },
    {
      id: "Some have attested",
      // same to seenAttestingBits: [0b11110001]
      notSeenAttestingBits: [0b00001110],
      attestationsToAdd: [
        {bits: [0b11111110], notSeenAttesterCount: 3},
        {bits: [0b00000011], notSeenAttesterCount: 1},
      ],
    },
    {
      id: "Non have attested",
      // same to seenAttestingBits: [0b00000000],
      notSeenAttestingBits: [0b11111111],
      attestationsToAdd: [
        {bits: [0b11111110], notSeenAttesterCount: 7},
        {bits: [0b00000011], notSeenAttesterCount: 2},
      ],
    },
  ];

  const attestationData = ssz.phase0.AttestationData.defaultValue();
  const committee = linspace(0, 7);

  for (const {id, notSeenAttestingBits, attestationsToAdd} of testCases) {
    it(id, () => {
      const attestationGroup = new MatchingDataAttestationGroup(committee, attestationData);

      const attestations = attestationsToAdd.map(
        ({bits}): phase0.Attestation => ({
          data: attestationData,
          aggregationBits: new BitArray(new Uint8Array(bits), 8),
          signature: validSignature,
        })
      );

      for (const attestation of attestations) {
        attestationGroup.add({attestation, trueBitsCount: attestation.aggregationBits.getTrueBitIndexes().length});
      }

      const notSeenAggBits = new BitArray(new Uint8Array(notSeenAttestingBits), 8);
      // const notSeenValidatorIndices: (ValidatorIndex | null)[] = [];
      const notSeenAttestingIndices = new Set<number>();
      for (let i = 0; i < committee.length; i++) {
        // notSeenValidatorIndices.push(notSeenAggBits.get(i) ? committee[i] : null);
        if (notSeenAggBits.get(i)) {
          notSeenAttestingIndices.add(i);
        }
      }
      const attestationsForBlock = attestationGroup.getAttestationsForBlock(
        // notSeenValidatorIndices,
        notSeenAttestingIndices
      );

      for (const [i, {notSeenAttesterCount}] of attestationsToAdd.entries()) {
        const attestation = attestationsForBlock.find((a) => a.attestation === attestations[i]);
        // If notSeenAttesterCount === 0 the attestation is not returned
        expect(attestation ? attestation.notSeenAttesterCount : 0).toBe(notSeenAttesterCount);
      }
    });
  }
});

describe("MatchingDataAttestationGroup aggregateInto", function () {
  const attestationSeed = ssz.phase0.Attestation.defaultValue();
  const attestation1 = {...attestationSeed, ...{aggregationBits: BitArray.fromBoolArray([false, true])}};
  const attestation2 = {...attestationSeed, ...{aggregationBits: BitArray.fromBoolArray([true, false])}};
  const mergedBitArray = BitArray.fromBoolArray([true, true]); // = [false, true] + [true, false]
  const attestationDataRoot = ssz.phase0.AttestationData.serialize(attestationSeed.data);
  let sk1: SecretKey;
  let sk2: SecretKey;

  beforeAll(async () => {
    sk1 = bls.SecretKey.fromBytes(Buffer.alloc(32, 1));
    sk2 = bls.SecretKey.fromBytes(Buffer.alloc(32, 2));
    attestation1.signature = sk1.sign(attestationDataRoot).toBytes();
    attestation2.signature = sk2.sign(attestationDataRoot).toBytes();
  });

  it("should aggregate 2 attestations", () => {
    const attWithIndex1 = {attestation: attestation1, trueBitsCount: 1};
    const attWithIndex2 = {attestation: attestation2, trueBitsCount: 1};
    aggregateInto(attWithIndex1, attWithIndex2);

    expect(renderBitArray(attWithIndex1.attestation.aggregationBits)).toEqual(renderBitArray(mergedBitArray));
    const aggregatedSignature = bls.Signature.fromBytes(attWithIndex1.attestation.signature, undefined, true);
    expect(aggregatedSignature.verifyAggregate([sk1.toPublicKey(), sk2.toPublicKey()], attestationDataRoot)).toBe(true);
  });
});
