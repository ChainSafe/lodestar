import {bls, SecretKey} from "@chainsafe/bls";
import {BitArray, fromHexString} from "@chainsafe/ssz";
import {initBLS} from "@chainsafe/lodestar-cli/src/util";
import {createIChainForkConfig, defaultChainConfig} from "@chainsafe/lodestar-config";
import {CachedBeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {expect} from "chai";
import {ssz, phase0} from "@chainsafe/lodestar-types";
import {
  AggregatedAttestationPool,
  aggregateInto,
  countNotSeenAttester,
  getParticipationFn,
  MatchingDataAttestationGroup,
} from "../../../../src/chain/opPools/aggregatedAttestationPool";
import {InsertOutcome} from "../../../../src/chain/opPools/types";
import {linspace} from "../../../../src/util/numpy";
import {generateAttestation, generateEmptyAttestation} from "../../../utils/attestation";
import {generateCachedState} from "../../../utils/state";
import {renderBitArray} from "../../../utils/render";

/** Valid signature of random data to prevent BLS errors */
const validSignature = fromHexString(
  "0xb2afb700f6c561ce5e1b4fedaec9d7c06b822d38c720cf588adfda748860a940adf51634b6788f298c552de40183b5a203b2bbe8b7dd147f0bb5bc97080a12efbb631c8888cb31a99cc4706eb3711865b8ea818c10126e4d818b542e9dbf9ae8"
);

describe("AggregatedAttestationPool", function () {
  let pool: AggregatedAttestationPool;
  const altairForkEpoch = 2020;
  const currentEpoch = altairForkEpoch + 10;
  const currentSlot = SLOTS_PER_EPOCH * currentEpoch;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createIChainForkConfig(Object.assign({}, defaultChainConfig, {ALTAIR_FORK_EPOCH: altairForkEpoch}));
  const originalState = generateCachedState({slot: currentSlot + 1}, config, true);
  let altairState: CachedBeaconStateAllForks;
  const attestation = generateAttestation({data: {slot: currentSlot, target: {epoch: currentEpoch}}});
  const committee = [0, 1, 2, 3, 4, 5, 6, 7];

  before(async function () {
    await initBLS();
  });

  beforeEach(() => {
    pool = new AggregatedAttestationPool();
    altairState = originalState.clone();
  });

  it("getParticipationFn", () => {
    // previousEpochParticipation and currentEpochParticipation is created inside generateCachedState
    // 0 and 1 are fully participated
    const participationFn = getParticipationFn(altairState);
    const participation = participationFn(currentEpoch, committee);
    expect(participation).to.deep.equal([0, 1], "Wrong participation set");
  });

  // previousEpochParticipation and currentEpochParticipation is created inside generateCachedState
  // 0 and 1 are fully participated
  const testCases: {name: string; attestingBits: number[]; isReturned: boolean}[] = [
    {name: "all validators are seen", attestingBits: [0b00000011], isReturned: false},
    {name: "all validators are NOT seen", attestingBits: [0b00001100], isReturned: true},
    {name: "one is seen and one is NOT", attestingBits: [0b00001100], isReturned: true},
  ];

  for (const {name, attestingBits, isReturned} of testCases) {
    it(name, function () {
      const aggregationBits = new BitArray(new Uint8Array(attestingBits), 8);
      pool.add({...attestation, aggregationBits}, aggregationBits.intersectValues(committee), committee);
      expect(pool.getAttestationsForBlock(altairState).length > 0).to.equal(isReturned, "Wrong attestation isReturned");
    });
  }

  it("incorrect source", function () {
    altairState.currentJustifiedCheckpoint.epoch = 1000;
    // all attesters are not seen
    const attestingIndices = [2, 3];
    pool.add(attestation, attestingIndices, committee);
    expect(pool.getAttestationsForBlock(altairState)).to.be.deep.equal([], "no attestation since incorrect source");
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

  const attestationData = generateEmptyAttestation().data;
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

      const results = attestations.map((attestation) => {
        const attestingIndices = attestation.aggregationBits.intersectValues(committee);
        return attestationGroup.add({attestation, attestingIndices, trueBitsCount: attestingIndices.length});
      });

      expect(results).to.deep.equal(
        attestationsToAdd.map((e) => e.res),
        "Wrong InsertOutcome results"
      );

      const attestationsAfterAdding = attestationGroup.getAttestations();

      for (const [i, {isKept}] of attestationsToAdd.entries()) {
        expect(attestationsAfterAdding.indexOf(attestations[i]) >= 0).to.equal(isKept, `Wrong attestation ${i} isKept`);
      }
    });
  }
});

describe("MatchingDataAttestationGroup.getAttestationsForBlock", () => {
  const testCases: {
    id: string;
    seenAttestingBits: number[];
    attestationsToAdd: {bits: number[]; notSeenAttesterCount: number}[];
  }[] = [
    // Note: attestationsToAdd MUST intersect in order to not be aggregated and distort the results
    {
      id: "All have attested",
      seenAttestingBits: [0b11111111],
      attestationsToAdd: [
        {bits: [0b11111110], notSeenAttesterCount: 0},
        {bits: [0b00000011], notSeenAttesterCount: 0},
      ],
    },
    {
      id: "Some have attested",
      seenAttestingBits: [0b11110001], // equals to indexes [ 0, 4, 5, 6, 7 ]
      attestationsToAdd: [
        {bits: [0b11111110], notSeenAttesterCount: 3},
        {bits: [0b00000011], notSeenAttesterCount: 1},
      ],
    },
    {
      id: "Non have attested",
      seenAttestingBits: [0b00000000],
      attestationsToAdd: [
        {bits: [0b11111110], notSeenAttesterCount: 7},
        {bits: [0b00000011], notSeenAttesterCount: 2},
      ],
    },
  ];

  const attestationData = generateEmptyAttestation().data;
  const committee = linspace(0, 7);

  for (const {id, seenAttestingBits, attestationsToAdd} of testCases) {
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
        const attestingIndices = attestation.aggregationBits.intersectValues(committee);
        attestationGroup.add({attestation, attestingIndices, trueBitsCount: attestingIndices.length});
      }

      const indices = new BitArray(new Uint8Array(seenAttestingBits), 8).intersectValues(committee);
      const attestationsForBlock = attestationGroup.getAttestationsForBlock(indices);

      for (const [i, {notSeenAttesterCount}] of attestationsToAdd.entries()) {
        const attestation = attestationsForBlock.find((a) => a.attestation === attestations[i]);
        // If notSeenAttesterCount === 0 the attestation is not returned
        expect(attestation ? attestation.notSeenAttesterCount : 0).to.equal(
          notSeenAttesterCount,
          `attestation ${i} wrong returned notSeenAttesterCount`
        );
      }
    });
  }
});

describe("MatchingDataAttestationGroup aggregateInto", function () {
  const attestationSeed = generateEmptyAttestation();
  const attestation1 = {...attestationSeed, ...{aggregationBits: BitArray.fromBoolArray([false, true])}};
  const attestation2 = {...attestationSeed, ...{aggregationBits: BitArray.fromBoolArray([true, false])}};
  const mergedBitArray = BitArray.fromBoolArray([true, true]); // = [false, true] + [true, false]
  const attestationDataRoot = ssz.phase0.AttestationData.serialize(attestationSeed.data);
  let sk1: SecretKey;
  let sk2: SecretKey;

  before("Init BLS", async () => {
    await initBLS();
    sk1 = bls.SecretKey.fromBytes(Buffer.alloc(32, 1));
    sk2 = bls.SecretKey.fromBytes(Buffer.alloc(32, 2));
    attestation1.signature = sk1.sign(attestationDataRoot).toBytes();
    attestation2.signature = sk2.sign(attestationDataRoot).toBytes();
  });

  it("should aggregate 2 attestations", () => {
    const attWithIndex1 = {attestation: attestation1, attestingIndices: [1], trueBitsCount: 1};
    const attWithIndex2 = {attestation: attestation2, attestingIndices: [0], trueBitsCount: 1};
    aggregateInto(attWithIndex1, attWithIndex2);

    expect(renderBitArray(attWithIndex1.attestation.aggregationBits)).to.be.deep.equal(
      renderBitArray(mergedBitArray),
      "invalid aggregationBits"
    );
    const aggregatedSignature = bls.Signature.fromBytes(attWithIndex1.attestation.signature, undefined, true);
    expect(
      aggregatedSignature.verifyAggregate([sk1.toPublicKey(), sk2.toPublicKey()], attestationDataRoot)
    ).to.be.equal(true, "invalid aggregated signature");
  });
});

describe("countNotSeenAttester", function () {
  const committee = [10, 11, 12, 13, 14, 15, 16, 17];
  const testCases: {
    committee: number[];
    attestingIndices: number[];
    seenAttestingIndices: number[];
    notSeenCount: number;
  }[] = [
    {
      committee,
      attestingIndices: [11, 12, 13, 14, 15, 16, 17],
      seenAttestingIndices: [10, 14, 15, 16, 17],
      notSeenCount: 3,
    },
    {committee, attestingIndices: [12, 14, 16], seenAttestingIndices: [10, 14, 15, 16, 17], notSeenCount: 1},
    {committee, attestingIndices: [10, 17], seenAttestingIndices: [14, 16], notSeenCount: 2},
    {committee, attestingIndices: [14, 16], seenAttestingIndices: [10, 17], notSeenCount: 2},
  ];

  for (const {committee, attestingIndices, seenAttestingIndices, notSeenCount} of testCases) {
    it(`attestingIndices ${attestingIndices.join(",")}, seenAttestingIndices ${seenAttestingIndices.join(",")}`, () => {
      expect(countNotSeenAttester(committee, attestingIndices, seenAttestingIndices)).to.be.equal(
        notSeenCount,
        `Not Seen Count should be ${notSeenCount}`
      );
    });
  }
});
