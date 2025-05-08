import {SecretKey, Signature, aggregateSignatures, fastAggregateVerify} from "@chainsafe/blst";
import {BitArray, fromHexString, toHexString} from "@chainsafe/ssz";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {
  ACTIVE_PRESET,
  FAR_FUTURE_EPOCH,
  ForkName,
  ForkPostElectra,
  MAX_COMMITTEES_PER_SLOT,
  MAX_EFFECTIVE_BALANCE,
  PresetName,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {CachedBeaconStateAllForks, CachedBeaconStateElectra, newFilledArray} from "@lodestar/state-transition";
import {CachedBeaconStateAltair} from "@lodestar/state-transition/src/types.js";
import {Attestation, electra, phase0, ssz} from "@lodestar/types";
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
  if (ACTIVE_PRESET !== PresetName.minimal) {
    throw Error(`ACTIVE_PRESET '${ACTIVE_PRESET}' must be minimal`);
  }

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
      forkchoiceStub.getBlockHex.mockReturnValue(generateProtoBlock({slot: attestation.data.slot}));
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
    forkchoiceStub.getBlockHex.mockReturnValue(generateProtoBlock({slot: attestation.data.slot}));
    forkchoiceStub.getDependentRoot.mockReturnValue("0xWeird");
    expect(pool.getAttestationsForBlock(fork, forkchoiceStub, altairState)).toEqual([]);
    // "forkchoice should be called to check pivot block"
    expect(forkchoiceStub.getDependentRoot).toHaveBeenCalledTimes(1);
  });
});

describe("AggregatedAttestationPool - get packed attestations - Electra", () => {
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
  // it will always include attestations for stateSlot - 1 which is currentSlot
  // so we want attestation slot to be less than that to test epochParticipation
  attestation.data.slot = currentSlot - 1;
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

  const committees = originalState.epochCtx.getBeaconCommittees(attestation.data.slot, committeeIndices);
  for (const committee of committees) {
    expect(committee.length).toEqual(committeeLength);
  }

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

  const testCases: {
    name: string;
    // item i is for committee i, which contains array of attester indices that's not seen (seen by default)
    notSeenInStateByCommittee: number[][];
    // item i is for committee i, each item is number[][] which is the indices of validators not seen by the committee
    // each item i also decides how many attestations added to the pool for that committee
    attParticipationByCommittee: number[][][];
    // expected committeeBits of packed attestations, item 0 is for returned attestation 0, ...
    packedCommitteeBits: number[][];
    // expected length of aggregationBits of packed attestations: item 0 is for returned attestation 0, ...
    packedAggregationBitsLen: number[];
    // expected backed Uint8Array of aggregationBits of packed attestations: item 0 is for returned attestation 0, ...
    packedAggregationBitsUint8Array: Uint8Array[];
  }[] = [
    {
      name: "Full participation",
      notSeenInStateByCommittee: [
        [0, 1, 2, 3],
        [0, 1, 2, 3],
        [0, 1, 2, 3],
        [0, 1, 2, 3],
      ],
      // each committee has exactly 1 full attestations
      attParticipationByCommittee: [[[]], [[]], [[]], [[]]],
      // 1 full packed attestation
      packedCommitteeBits: [[0, 1, 2, 3]],
      packedAggregationBitsLen: [committeeLength * 4],
      packedAggregationBitsUint8Array: [
        new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]),
      ],
    },
    {
      name: "Full participation but all are seen in the state",
      notSeenInStateByCommittee: [[], [], [], []],
      // each committee has exactly 1 full attestations
      attParticipationByCommittee: [[[]], [[]], [[]], [[]]],
      // no packed attestation
      packedCommitteeBits: [],
      packedAggregationBitsLen: [],
      packedAggregationBitsUint8Array: [],
    },
    {
      name: "Committee 1 and 2 has 2 versions of aggregationBits",
      notSeenInStateByCommittee: [
        [0, 1, 2, 3],
        [0, 1, 2, 3],
        [0, 1, 2, 3],
        [0, 1, 2, 3],
      ],
      // committee 1 has 2 attestations, one with no participation validator 0, one with no participation validator 1
      // committee 2 has 2 attestations, one with no participation validator 1, one with no participation validator 2
      // committee 0 and 3 has 1 attestation each, and all validators are seen
      attParticipationByCommittee: [[[]], [[0], [1]], [[1], [2]], [[]]],
      // 2nd packed attestation only has 2 committees: 1 and 2
      packedCommitteeBits: [
        [0, 1, 2, 3],
        [1, 2],
      ],
      packedAggregationBitsLen: [committeeLength * 4, committeeLength * 2],
      packedAggregationBitsUint8Array: [
        new Uint8Array([255, 255, 255, 255, 0b11111110, 255, 255, 255, 0b11111101, 255, 255, 255, 255, 255, 255, 255]),
        new Uint8Array([0b11111101, 255, 255, 255, 0b11111011, 255, 255, 255]),
      ],
    },
    {
      // same to above but no-participation validators are all seen in the state so only 1 attestation is returned
      name: "Committee 1 and 2 has 2 versions of aggregationBits - only 1 attestation is included",
      notSeenInStateByCommittee: [
        [0, 1, 2, 3],
        [2, 3],
        [0, 1],
        [0, 1, 2, 3],
      ],
      // committee 1 has 2 attestations, one with no participation validator 0, one with no participation validator 1
      // committee 2 has 2 attestations, one with no participation validator 1, one with no participation validator 2
      // committee 0 and 3 has 1 attestation each, and all validators are seen
      attParticipationByCommittee: [[[]], [[0], [1]], [[1], [2]], [[]]],
      packedCommitteeBits: [[0, 1, 2, 3]],
      packedAggregationBitsLen: [committeeLength * 4],
      packedAggregationBitsUint8Array: [
        new Uint8Array([255, 255, 255, 255, 0b11111110, 255, 255, 255, 0b11111011, 255, 255, 255, 255, 255, 255, 255]),
      ],
    },
    {
      name: "Only committee 1 has 2 versions of aggregationBits",
      notSeenInStateByCommittee: [
        [0, 1, 2, 3],
        [0, 1, 2, 3],
        [0, 1, 2, 3],
        [0, 1, 2, 3],
      ],
      // committee 1 has 2 attestations, one with no participation validator 0, one with no participation validator 1
      // other committees have 1 attestation each, and all validators are seen
      attParticipationByCommittee: [[[]], [[0], [1]], [[]], [[]]],
      // 2nd packed attestation only has 1 committee
      packedCommitteeBits: [[0, 1, 2, 3], [1]],
      // 2nd packed attestation only has 1 committee
      packedAggregationBitsLen: [committeeLength * 4, committeeLength],
      packedAggregationBitsUint8Array: [
        new Uint8Array([255, 255, 255, 255, 0b11111110, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]),
        new Uint8Array([0b11111101, 255, 255, 255]),
      ],
    },
  ];

  for (const {
    name,
    notSeenInStateByCommittee,
    attParticipationByCommittee,
    packedCommitteeBits,
    packedAggregationBitsLen,
    packedAggregationBitsUint8Array,
  } of testCases) {
    it(name, () => {
      // this is related to NotSeenValidatorsFn, all validators are seen by default
      const epochParticipation = newFilledArray(vc, 0b111);
      for (let i = 0; i < committeeIndices.length; i++) {
        const committeeIndex = committeeIndices[i];
        const notSeenValidators = notSeenInStateByCommittee[i];
        const committee = committees[committeeIndex];
        for (const notSeenValidator of notSeenValidators) {
          const validatorIndex = committee[notSeenValidator];
          epochParticipation[validatorIndex] = 0b000;
        }
      }

      (electraState as CachedBeaconStateElectra).previousEpochParticipation =
        ssz.altair.EpochParticipation.toViewDU(epochParticipation);
      (electraState as CachedBeaconStateElectra).currentEpochParticipation =
        ssz.altair.EpochParticipation.toViewDU(epochParticipation);
      electraState.commit();

      for (let i = 0; i < committeeIndices.length; i++) {
        const committeeIndex = committeeIndices[i];
        const committeeBits = BitArray.fromSingleBit(MAX_COMMITTEES_PER_SLOT, committeeIndex);
        // same committee, each is by attestation
        const notSeenValidatorsByAttestationIndex = attParticipationByCommittee[i];
        for (const notSeenValidators of notSeenValidatorsByAttestationIndex) {
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
      expect(packedCommitteeBits.length).toBe(packedAggregationBitsLen.length);
      expect(blockAttestations.length).toBe(packedCommitteeBits.length);
      for (let attIndex = 0; attIndex < blockAttestations.length; attIndex++) {
        const returnedAttestation = blockAttestations[attIndex] as Attestation<ForkPostElectra>;
        expect(returnedAttestation.committeeBits.getTrueBitIndexes()).toStrictEqual(packedCommitteeBits[attIndex]);
        expect(returnedAttestation.aggregationBits.bitLen).toStrictEqual(packedAggregationBitsLen[attIndex]);
        expect(returnedAttestation.aggregationBits.uint8Array).toStrictEqual(packedAggregationBitsUint8Array[attIndex]);
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
    attestationsToAdd: {
      bits: number[];
      newSeenEffectiveBalance: number;
      newSeenAttesters: number;
      notSeenCommitteeMembers: Set<number> | null;
      // this comes from the find() api, -1 means not found
      returnedIndex: number;
    }[];
  }[] = [
    // Note: attestationsToAdd MUST intersect in order to not be aggregated and distort the results
    {
      id: "All have attested",
      // same to seenAttestingBits: [0b11111111],
      notSeenAttestingBits: [0b00000000],
      effectiveBalanceIncrements: new Uint16Array(8).fill(32),
      attestationsToAdd: [
        {
          bits: [0b11111110],
          newSeenEffectiveBalance: 0,
          newSeenAttesters: 0,
          notSeenCommitteeMembers: null,
          returnedIndex: -1,
        },
        {
          bits: [0b00000011],
          newSeenEffectiveBalance: 0,
          newSeenAttesters: 0,
          notSeenCommitteeMembers: null,
          returnedIndex: -1,
        },
      ],
    },
    {
      id: "Same effective balance - 2nd attestation is not valuable",
      // same to seenAttestingBits: [0b11110001]
      notSeenAttestingBits: [0b00001110],
      effectiveBalanceIncrements: new Uint16Array(8).fill(32),
      attestationsToAdd: [
        {
          bits: [0b11111110],
          newSeenEffectiveBalance: 3 * 32,
          newSeenAttesters: 3,
          notSeenCommitteeMembers: new Set([]),
          returnedIndex: 0,
        },
        // not valuable because seen attestations are all included in attestation 0
        {
          bits: [0b00000011],
          newSeenEffectiveBalance: 0,
          newSeenAttesters: 0,
          notSeenCommitteeMembers: null,
          returnedIndex: -1,
        },
      ],
    },
    {
      id: "Same effective balance - include both",
      // same to seenAttestingBits: [0b11110001]
      notSeenAttestingBits: [0b00001110],
      effectiveBalanceIncrements: new Uint16Array(8).fill(32),
      attestationsToAdd: [
        {
          bits: [0b11111010],
          newSeenEffectiveBalance: 2 * 32,
          newSeenAttesters: 2,
          notSeenCommitteeMembers: new Set([2]),
          returnedIndex: 0,
        },
        {
          bits: [0b10000101],
          newSeenEffectiveBalance: 1 * 32,
          newSeenAttesters: 1,
          notSeenCommitteeMembers: new Set(),
          returnedIndex: 1,
        },
      ],
    },
    {
      id: "Prioritize bigger effective balance",
      notSeenAttestingBits: [0b11111111],
      effectiveBalanceIncrements: new Uint16Array([32, 2048, 32, 32, 32, 32, 32, 32]),
      attestationsToAdd: [
        // newSeenEffectiveBalance is not 6 * 32 considering the 1st included attestation
        {
          bits: [0b11111001],
          newSeenEffectiveBalance: 4 * 32,
          newSeenAttesters: 4,
          notSeenCommitteeMembers: new Set([2]),
          returnedIndex: 1,
        },
        // although this has less not seen attesters, it has bigger effective balance so returned index is 0
        {
          bits: [0b10000011],
          newSeenEffectiveBalance: 2048 + 2 * 32,
          newSeenAttesters: 3,
          notSeenCommitteeMembers: new Set([2, 3, 4, 5, 6]),
          returnedIndex: 0,
        },
        // maxAttestation is only 2
        {
          bits: [0b00001101],
          newSeenEffectiveBalance: 0,
          newSeenAttesters: 0,
          notSeenCommitteeMembers: null,
          returnedIndex: -1,
        },
      ],
    },
    {
      id: "Non have attested",
      // same to seenAttestingBits: [0b00000000],
      notSeenAttestingBits: [0b11111111],
      effectiveBalanceIncrements: new Uint16Array(8).fill(32),
      attestationsToAdd: [
        {
          bits: [0b00111110],
          newSeenEffectiveBalance: 5 * 32,
          newSeenAttesters: 5,
          notSeenCommitteeMembers: new Set([0, 6, 7]),
          returnedIndex: 0,
        },
        // newSeenEffectiveBalance is not 3 * 32 considering the 1st included attestation already include attester 1
        {
          bits: [0b01000011],
          newSeenEffectiveBalance: 2 * 32,
          newSeenAttesters: 2,
          notSeenCommitteeMembers: new Set([7]),
          returnedIndex: 1,
        },
      ],
    },
  ];

  const attestationData = ssz.phase0.AttestationData.defaultValue();
  const committee = Uint32Array.from(linspace(0, 7));

  for (const {id, notSeenAttestingBits, effectiveBalanceIncrements, attestationsToAdd} of testCases) {
    // these are for electra attestations but it should work the same way to pre-electra
    it(id, () => {
      const attestationGroup = new MatchingDataAttestationGroup(config, committee, attestationData);

      const attestations = attestationsToAdd.map(
        ({bits}): electra.Attestation => ({
          data: attestationData,
          aggregationBits: new BitArray(new Uint8Array(bits), 8),
          signature: validSignature,
          committeeBits: BitArray.fromSingleBit(MAX_COMMITTEES_PER_SLOT, 0),
        })
      );

      for (const attestation of attestations) {
        attestationGroup.add({attestation, trueBitsCount: attestation.aggregationBits.getTrueBitIndexes().length});
      }

      const notSeenAggBits = new BitArray(new Uint8Array(notSeenAttestingBits), 8);
      const notSeenCommitteeMembers = new Set<number>();
      for (let i = 0; i < committee.length; i++) {
        // notSeenValidatorIndices.push(notSeenAggBits.get(i) ? committee[i] : null);
        if (notSeenAggBits.get(i)) {
          notSeenCommitteeMembers.add(i);
        }
      }
      const attestationsForBlock = attestationGroup.getAttestationsForBlock(
        ForkName.electra,
        effectiveBalanceIncrements,
        notSeenCommitteeMembers,
        maxAttestations
      ).result;

      for (const [
        i,
        {newSeenEffectiveBalance, newSeenAttesters, notSeenCommitteeMembers: notSeenAttendingIndices, returnedIndex},
      ] of attestationsToAdd.entries()) {
        const attestationIndex = attestationsForBlock.findIndex((a) => a.attestation === attestations[i]);
        expect(attestationIndex).toBe(returnedIndex);
        const attestation = attestationsForBlock[attestationIndex];
        // If notSeenAttesterCount === 0 the attestation is not returned
        if (returnedIndex !== -1) {
          expect(attestation ? attestation.newSeenEffectiveBalance : 0).toBe(newSeenEffectiveBalance);
          expect(attestation ? attestation.newSeenAttesters : 0).toBe(newSeenAttesters);
          expect(attestation ? attestation.notSeenCommitteeMembers : 0).toStrictEqual(notSeenAttendingIndices);
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
        totalNewSeenEffectiveBalance: 0,
        totalAttesters: 32,
        newSeenAttesters: 0,
        notSeenAttesters: 0,
      };
      // to simplify, instead of signing the signingRoot, just sign the attData root
      const sigArr = skArr.map((sk) => sk.sign(ssz.phase0.AttestationData.hashTreeRoot(attData)));
      const attestationSeed = ssz.electra.Attestation.defaultValue();
      for (let i = 0; i < committeeIndices.length; i++) {
        const committeeIndex = committeeIndices[i];
        const committeeBits = BitArray.fromBoolArray(
          Array.from({length: MAX_COMMITTEES_PER_SLOT}, (_, i) => i === committeeIndex)
        );
        const aggAttestation = {
          ...attestationSeed,
          aggregationBits: new BitArray(new Uint8Array(aggregationBitsArr[i]), 3),
          committeeBits,
          signature: sigArr[i].toBytes(),
        };
        consolidation.byCommittee.set(committeeIndex, {
          attestation: aggAttestation,
          newSeenEffectiveBalance: aggregationBitsArr[i].filter((item) => item).length * 32,
          notSeenCommitteeMembers: new Set(),
          newSeenAttesters: 0,
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
