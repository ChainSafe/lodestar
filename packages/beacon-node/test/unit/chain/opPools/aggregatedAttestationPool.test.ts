import {SecretKey, Signature, aggregateSignatures, fastAggregateVerify} from "@chainsafe/blst";
import {BitArray, fromHexString, toHexString} from "@chainsafe/ssz";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {
  FAR_FUTURE_EPOCH,
  ForkName,
  ForkPostElectra,
  MAX_COMMITTEES_PER_SLOT,
  MAX_EFFECTIVE_BALANCE,
  MAX_VALIDATORS_PER_COMMITTEE,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {CachedBeaconStateAllForks, CachedBeaconStateElectra, newFilledArray} from "@lodestar/state-transition";
import {CachedBeaconStateAltair} from "@lodestar/state-transition/src/types.js";
import {Attestation, phase0, ssz} from "@lodestar/types";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {
  AggregatedAttestationPool,
  AttestationsConsolidation,
  MatchingDataAttestationGroup,
  aggregateConsolidation,
  aggregateInto,
  getNotSeenValidatorsFn,
} from "../../../../src/chain/opPools/aggregatedAttestationPool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";
import {ZERO_HASH_HEX} from "../../../../src/constants/constants.js";
import {linspace} from "../../../../src/util/numpy.js";
import {MockedForkChoice, getMockedForkChoice} from "../../../mocks/mockedBeaconChain.js";
import {renderBitArray} from "../../../utils/render.js";
import {generateCachedAltairState, generateCachedElectraState} from "../../../utils/state.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";
import {generateValidators} from "../../../utils/validator.js";

/** Valid signature of random data to prevent BLS errors */
const validSignature = fromHexString(
  "0xb2afb700f6c561ce5e1b4fedaec9d7c06b822d38c720cf588adfda748860a940adf51634b6788f298c552de40183b5a203b2bbe8b7dd147f0bb5bc97080a12efbb631c8888cb31a99cc4706eb3711865b8ea818c10126e4d818b542e9dbf9ae8"
);

describe("AggregatedAttestationPool - Altair", () => {
  let pool: AggregatedAttestationPool;
  const fork = ForkName.altair;
  const config = createChainForkConfig({
    ...defaultChainConfig,
  });
  const altairForkEpoch = 2020;
  const currentEpoch = altairForkEpoch + 10;
  const currentSlot = SLOTS_PER_EPOCH * currentEpoch;

  const committeeIndex = 0;
  const attestation = ssz.phase0.Attestation.defaultValue();
  // state slot is (currentSlot + 1) so if set attestation slot to currentSlot, it will be included in the block
  attestation.data.slot = currentSlot - 1;
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
  const committee = originalState.epochCtx.getBeaconCommittee(currentSlot - 1, committeeIndex);
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
  (originalState as CachedBeaconStateAltair).previousEpochParticipation =
    ssz.altair.EpochParticipation.toViewDU(epochParticipation);
  (originalState as CachedBeaconStateAltair).currentEpochParticipation =
    ssz.altair.EpochParticipation.toViewDU(epochParticipation);
  originalState.commit();
  let altairState: CachedBeaconStateAllForks;

  let forkchoiceStub: MockedForkChoice;

  beforeEach(() => {
    pool = new AggregatedAttestationPool(config);
    altairState = originalState.clone();
    forkchoiceStub = getMockedForkChoice();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("getNotSeenValidatorsFn", () => {
    // previousEpochParticipation and currentEpochParticipation is created inside generateCachedState
    // 0 and 1 are fully participated
    const notSeenValidatorFn = getNotSeenValidatorsFn(altairState);
    // seen attesting indices are 0, 1 => not seen are 2, 3
    expect(notSeenValidatorFn(currentEpoch, currentSlot - 1, committeeIndex)).toEqual(new Set([2, 3]));
    // attestations in current slot are always included (since altairState.slot = currentSlot + 1)
    expect(notSeenValidatorFn(currentEpoch, currentSlot, committeeIndex)).toEqual(new Set([0, 1, 2, 3]));
  });

  // previousEpochParticipation and currentEpochParticipation is created inside generateCachedState
  // 0 and 1 are fully participated
  const testCases: {name: string; attestingBits: number[]; isReturned: boolean}[] = [
    {name: "all validators are seen", attestingBits: [0b00000011], isReturned: false},
    {name: "all validators are NOT seen", attestingBits: [0b00001100], isReturned: true},
    {name: "one is seen and one is NOT", attestingBits: [0b00001101], isReturned: true},
  ];

  for (const {name, attestingBits, isReturned} of testCases) {
    it(name, () => {
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
        expect(pool.getAttestationsForBlock(fork, forkchoiceStub, altairState).length).toBeGreaterThan(0);
      } else {
        expect(pool.getAttestationsForBlock(fork, forkchoiceStub, altairState).length).toEqual(0);
      }
      // "forkchoice should be called to check pivot block"
      expect(forkchoiceStub.getDependentRoot).toHaveBeenCalledTimes(1);
    });
  }

  it("incorrect source", () => {
    altairState.currentJustifiedCheckpoint.epoch = 1000;
    // all attesters are not seen
    const attestingIndices = [2, 3];
    pool.add(attestation, attDataRootHex, attestingIndices.length, committee);
    expect(pool.getAttestationsForBlock(fork, forkchoiceStub, altairState)).toEqual([]);
    // "forkchoice should not be called"
    expect(forkchoiceStub.iterateAncestorBlocks).not.toHaveBeenCalledTimes(1);
  });

  it("incompatible shuffling - incorrect pivot block root", () => {
    // all attesters are not seen
    const attestingIndices = [2, 3];
    pool.add(attestation, attDataRootHex, attestingIndices.length, committee);
    forkchoiceStub.getBlockHex.mockReturnValue(generateProtoBlock());
    forkchoiceStub.getDependentRoot.mockReturnValue("0xWeird");
    expect(pool.getAttestationsForBlock(fork, forkchoiceStub, altairState)).toEqual([]);
    // "forkchoice should be called to check pivot block"
    expect(forkchoiceStub.getDependentRoot).toHaveBeenCalledTimes(1);
  });
});

describe("AggregatedAttestationPool - Electra", () => {
  let pool: AggregatedAttestationPool;
  const fork = ForkName.electra;
  const electraForkEpoch = 2020;
  const config = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: electraForkEpoch,
  });
  const currentEpoch = electraForkEpoch + 10;
  const currentSlot = SLOTS_PER_EPOCH * currentEpoch;

  const committeeIndices = [0, 1, 2, 3];
  const attestation = ssz.electra.Attestation.defaultValue();
  attestation.data.slot = currentSlot;
  attestation.data.index = 0; // Must be zero post-electra
  attestation.data.target.epoch = currentEpoch;
  attestation.signature = validSignature;
  const attDataRootHex = toHexString(ssz.phase0.AttestationData.hashTreeRoot(attestation.data));

  const validatorOpts = {
    activationEpoch: 0,
    effectiveBalance: MAX_EFFECTIVE_BALANCE,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
    exitEpoch: FAR_FUTURE_EPOCH,
  };
  // this makes a committee length of 4
  const vc = 1024;
  const committeeLength = 32;
  const validators = generateValidators(vc, validatorOpts);
  const originalState = generateCachedElectraState({slot: currentSlot + 1, validators}, electraForkEpoch);
  expect(originalState.epochCtx.getCommitteeCountPerSlot(currentEpoch)).toEqual(committeeIndices.length);

  const committees = originalState.epochCtx.getBeaconCommittees(currentSlot, committeeIndices);

  const epochParticipation = newFilledArray(vc, 0b000);
  for (const committee of committees) {
    expect(committee.length).toEqual(committeeLength);
  }

  (originalState as CachedBeaconStateElectra).previousEpochParticipation =
    ssz.altair.EpochParticipation.toViewDU(epochParticipation);
  (originalState as CachedBeaconStateElectra).currentEpochParticipation =
    ssz.altair.EpochParticipation.toViewDU(epochParticipation);
  originalState.commit();
  let electraState: CachedBeaconStateAllForks;

  let forkchoiceStub: MockedForkChoice;

  beforeEach(() => {
    pool = new AggregatedAttestationPool(config);
    electraState = originalState.clone();
    forkchoiceStub = getMockedForkChoice();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // notSeenByCommittees: item i is for committe i, each item is number[][] which is the indices of validators not seen by the committee
  // expectedCommitteeBits is by returned attestations: expectedCommitteeBits[0] is for returned attestation 0, ...
  // expectedAggregationBits is the aggregation bits of the returned attestations: expectedAggregationBits[0] is for returned attestation 0, ...
  const testCases: {
    name: string;
    notSeenByCommittees: number[][][];
    expectedCommitteeBits: number[][];
    expectedAggregationBits: number[];
  }[] = [
    {
      name: "Full participation",
      notSeenByCommittees: [[[]], [[]], [[]], [[]]],
      expectedCommitteeBits: [[0, 1, 2, 3]],
      expectedAggregationBits: [committeeLength * 4],
    },
    {
      name: "Committee 1 and 2 has 2 versions of aggregationBits",
      // committee 1 has 2 attestations, one with not seen validator 0, one with not seen validator 1
      // committee 2 has 2 attestations, one with not seen validator 1, one with not seen validator 2
      // other committees have 1 attestation each, and all validators are seen
      notSeenByCommittees: [[[]], [[0], [1]], [[1], [2]], [[]]],
      // 2nd consolidation only has 2 committees: 1 and 2
      expectedCommitteeBits: [
        [0, 1, 2, 3],
        [1, 2],
      ],
      expectedAggregationBits: [committeeLength * 4, committeeLength * 2],
    },
    {
      name: "Only committee 1 has 2 versions of aggregationBits",
      // committee 1 has 2 attestations, one with not seen validator 0, one with not seen validator 1
      // other committees have 1 attestation each, and all validators are seen
      notSeenByCommittees: [[[]], [[0], [1]], [[]], [[]]],
      // 2nd consolidation only has 1 committeee
      expectedCommitteeBits: [[0, 1, 2, 3], [1]],
      expectedAggregationBits: [committeeLength * 4, committeeLength],
    },
  ];

  for (const {name, notSeenByCommittees, expectedCommitteeBits, expectedAggregationBits} of testCases) {
    it(name, () => {
      for (let i = 0; i < committeeIndices.length; i++) {
        const committeeIndex = committeeIndices[i];
        const committeeBits = BitArray.fromSingleBit(MAX_COMMITTEES_PER_SLOT, committeeIndex);
        // same committee, each is by attestation
        const notSeenValidatorsByAtt = notSeenByCommittees[i];
        for (const notSeenValidators of notSeenValidatorsByAtt) {
          const aggregationBits = new BitArray(new Uint8Array(committeeLength / 8).fill(255), committeeLength);
          for (const index of notSeenValidators) {
            aggregationBits.set(index, false);
          }
          const attestationi: Attestation<ForkPostElectra> = {
            ...attestation,
            aggregationBits,
            committeeBits,
          };

          pool.add(attestationi, attDataRootHex, aggregationBits.getTrueBitIndexes().length, committees[i]);
        }
      }

      forkchoiceStub.getBlockHex.mockReturnValue(generateProtoBlock());
      forkchoiceStub.getDependentRoot.mockReturnValue(ZERO_HASH_HEX);

      const blockAttestations = pool.getAttestationsForBlock(fork, forkchoiceStub, electraState);
      // make sure test data is correct
      expect(expectedCommitteeBits.length).toBe(expectedAggregationBits.length);
      expect(blockAttestations.length).toBe(expectedCommitteeBits.length);
      for (let attIndex = 0; attIndex < blockAttestations.length; attIndex++) {
        const returnedAttestation = blockAttestations[attIndex] as Attestation<ForkPostElectra>;
        expect(returnedAttestation.committeeBits.getTrueBitIndexes()).toStrictEqual(expectedCommitteeBits[attIndex]);
        expect(returnedAttestation.aggregationBits.bitLen).toStrictEqual(expectedAggregationBits[attIndex]);
      }
    });
  }
});

describe("MatchingDataAttestationGroup.add()", () => {
  const config = createChainForkConfig({
    ...defaultChainConfig,
  });

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
  const committee = Uint32Array.from(linspace(0, 7));

  for (const {id, attestationsToAdd} of testCases) {
    it(id, () => {
      const attestationGroup = new MatchingDataAttestationGroup(config, committee, attestationData);

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
  const config = createChainForkConfig({
    ...defaultChainConfig,
  });

  const maxAttestations = 2;
  const testCases: {
    id: string;
    notSeenAttestingBits: number[];
    effectiveBalanceIncrements: Uint16Array;
    attestationsToAdd: {bits: number[]; notSeenEffectiveBalance: number; returnedIndex: number}[];
  }[] = [
    // Note: attestationsToAdd MUST intersect in order to not be aggregated and distort the results
    {
      id: "All have attested",
      // same to seenAttestingBits: [0b11111111],
      notSeenAttestingBits: [0b00000000],
      effectiveBalanceIncrements: new Uint16Array(8).fill(32),
      attestationsToAdd: [
        {bits: [0b11111110], notSeenEffectiveBalance: 0, returnedIndex: -1},
        {bits: [0b00000011], notSeenEffectiveBalance: 0, returnedIndex: -1},
      ],
    },
    {
      id: "Some have attested - same effective balance",
      // same to seenAttestingBits: [0b11110001]
      notSeenAttestingBits: [0b00001110],
      effectiveBalanceIncrements: new Uint16Array(8).fill(32),
      attestationsToAdd: [
        {bits: [0b11111110], notSeenEffectiveBalance: 3 * 32, returnedIndex: 0},
        {bits: [0b00000011], notSeenEffectiveBalance: 1 * 32, returnedIndex: 1},
      ],
    },
    {
      id: "Some have attested - prioritize bigger effective balance",
      notSeenAttestingBits: [0b11111111],
      effectiveBalanceIncrements: new Uint16Array([32, 2048, 32, 32, 32, 32, 32, 32]),
      attestationsToAdd: [
        {bits: [0b11111001], notSeenEffectiveBalance: 6 * 32, returnedIndex: 1},
        // although this has less not seen attesters, it has bigger effective balance so returned index is 0
        {bits: [0b10000011], notSeenEffectiveBalance: 2048 + 2 * 32, returnedIndex: 0},
        {bits: [0b00001101], notSeenEffectiveBalance: 3 * 32, returnedIndex: -1},
      ],
    },
    {
      id: "Non have attested",
      // same to seenAttestingBits: [0b00000000],
      notSeenAttestingBits: [0b11111111],
      effectiveBalanceIncrements: new Uint16Array(8).fill(32),
      attestationsToAdd: [
        {bits: [0b11111110], notSeenEffectiveBalance: 7 * 32, returnedIndex: 0},
        {bits: [0b00000011], notSeenEffectiveBalance: 2 * 32, returnedIndex: 1},
      ],
    },
  ];

  const attestationData = ssz.phase0.AttestationData.defaultValue();
  const committee = Uint32Array.from(linspace(0, 7));

  for (const {id, notSeenAttestingBits, effectiveBalanceIncrements, attestationsToAdd} of testCases) {
    // TODO: tests electra
    it(id, () => {
      const attestationGroup = new MatchingDataAttestationGroup(config, committee, attestationData);

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
      const notSeenAttestingIndices = new Set<number>();
      for (let i = 0; i < committee.length; i++) {
        // notSeenValidatorIndices.push(notSeenAggBits.get(i) ? committee[i] : null);
        if (notSeenAggBits.get(i)) {
          notSeenAttestingIndices.add(i);
        }
      }
      const attestationsForBlock = attestationGroup.getAttestationsForBlock(
        ForkName.phase0,
        effectiveBalanceIncrements,
        notSeenAttestingIndices,
        maxAttestations
      );

      for (const [i, {notSeenEffectiveBalance, returnedIndex}] of attestationsToAdd.entries()) {
        const attestationIndex = attestationsForBlock.findIndex((a) => a.attestation === attestations[i]);
        expect(attestationIndex).toBe(returnedIndex);
        const attestation = attestationsForBlock[attestationIndex];
        // If notSeenAttesterCount === 0 the attestation is not returned
        if (returnedIndex !== -1) {
          expect(attestation ? attestation.notSeenEffectiveBalance : 0).toBe(notSeenEffectiveBalance);
        }
      }
    });
  }
});

describe("MatchingDataAttestationGroup aggregateInto", () => {
  const attestationSeed = ssz.phase0.Attestation.defaultValue();
  const attestation1 = {...attestationSeed, ...{aggregationBits: BitArray.fromBoolArray([false, true])}};
  const attestation2 = {...attestationSeed, ...{aggregationBits: BitArray.fromBoolArray([true, false])}};
  const mergedBitArray = BitArray.fromBoolArray([true, true]); // = [false, true] + [true, false]
  const attestationDataRoot = ssz.phase0.AttestationData.serialize(attestationSeed.data);
  let sk1: SecretKey;
  let sk2: SecretKey;

  beforeAll(async () => {
    sk1 = SecretKey.fromBytes(Buffer.alloc(32, 1));
    sk2 = SecretKey.fromBytes(Buffer.alloc(32, 2));
    attestation1.signature = sk1.sign(attestationDataRoot).toBytes();
    attestation2.signature = sk2.sign(attestationDataRoot).toBytes();
  });

  it("should aggregate 2 attestations", () => {
    const attWithIndex1 = {attestation: attestation1, trueBitsCount: 1};
    const attWithIndex2 = {attestation: attestation2, trueBitsCount: 1};
    aggregateInto(attWithIndex1, attWithIndex2);

    expect(renderBitArray(attWithIndex1.attestation.aggregationBits)).toEqual(renderBitArray(mergedBitArray));
    const aggregatedSignature = Signature.fromBytes(attWithIndex1.attestation.signature, true, true);
    expect(fastAggregateVerify(attestationDataRoot, [sk1.toPublicKey(), sk2.toPublicKey()], aggregatedSignature)).toBe(
      true
    );
  });
});

describe("aggregateConsolidation", () => {
  const sk0 = SecretKey.fromBytes(Buffer.alloc(32, 1));
  const sk1 = SecretKey.fromBytes(Buffer.alloc(32, 2));
  const sk2 = SecretKey.fromBytes(Buffer.alloc(32, 3));
  const skArr = [sk0, sk1, sk2];
  const testCases: {
    name: string;
    committeeIndices: number[];
    aggregationBitsArr: Array<number>[];
    expectedAggregationBits: Array<number>;
    expectedCommitteeBits: Array<boolean>;
  }[] = [
    // note that bit index starts from the right
    {
      name: "test case 0",
      committeeIndices: [0, 1, 2],
      aggregationBitsArr: [[0b111], [0b011], [0b111]],
      expectedAggregationBits: [0b11011111, 0b1],
      expectedCommitteeBits: [true, true, true, false],
    },
    {
      name: "test case 1",
      committeeIndices: [2, 3, 1],
      aggregationBitsArr: [[0b100], [0b010], [0b001]],
      expectedAggregationBits: [0b10100001, 0b0],
      expectedCommitteeBits: [false, true, true, true],
    },
  ];
  for (const {
    name,
    committeeIndices,
    aggregationBitsArr,
    expectedAggregationBits,
    expectedCommitteeBits,
  } of testCases) {
    it(name, () => {
      const attData = ssz.phase0.AttestationData.defaultValue();
      const consolidation: AttestationsConsolidation = {
        byCommittee: new Map(),
        attData: attData,
        totalNotSeenEffectiveBalance: 0,
      };
      // to simplify, instead of signing the signingRoot, just sign the attData root
      const sigArr = skArr.map((sk) => sk.sign(ssz.phase0.AttestationData.hashTreeRoot(attData)));
      const attestationSeed = ssz.electra.Attestation.defaultValue();
      for (let i = 0; i < committeeIndices.length; i++) {
        const committeeIndex = committeeIndices[i];
        const commiteeBits = BitArray.fromBoolArray(
          Array.from({length: MAX_COMMITTEES_PER_SLOT}, (_, i) => i === committeeIndex)
        );
        const aggAttestation = {
          ...attestationSeed,
          aggregationBits: new BitArray(new Uint8Array(aggregationBitsArr[i]), 3),
          committeeBits: commiteeBits,
          signature: sigArr[i].toBytes(),
        };
        consolidation.byCommittee.set(committeeIndex, {
          attestation: aggAttestation,
          notSeenEffectiveBalance: aggregationBitsArr[i].filter((item) => item).length * 32,
        });
      }

      const finalAttestation = aggregateConsolidation(consolidation);
      expect(finalAttestation.aggregationBits.uint8Array).toEqual(new Uint8Array(expectedAggregationBits));
      expect(finalAttestation.committeeBits.toBoolArray()).toEqual(expectedCommitteeBits);
      expect(finalAttestation.data).toEqual(attData);
      expect(finalAttestation.signature).toEqual(aggregateSignatures(sigArr).toBytes());
    });
  }
});
