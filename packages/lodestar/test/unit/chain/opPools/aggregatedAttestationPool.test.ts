import {bls, SecretKey} from "@chainsafe/bls";
import {initBLS} from "@chainsafe/lodestar-cli/src/util";
import {createIChainForkConfig, defaultChainConfig} from "@chainsafe/lodestar-config";
import {CachedBeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {List} from "@chainsafe/ssz";
import {expect} from "chai";
import {ssz, phase0} from "@chainsafe/lodestar-types";
import {
  AggregatedAttestationPool,
  aggregateInto,
  MatchingDataAttestationGroup,
} from "../../../../src/chain/opPools/aggregatedAttestationPool";
import {InsertOutcome} from "../../../../src/chain/opPools/types";
import {generateAttestation, generateEmptyAttestation} from "../../../utils/attestation";
import {generateCachedState} from "../../../utils/state";
import sinon from "sinon";

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
  const committee = [0, 1, 2, 3];

  before(async function () {
    await initBLS();
  });

  beforeEach(() => {
    pool = new AggregatedAttestationPool();
    altairState = originalState.clone();
  });

  this.afterEach(() => {
    sinon.restore();
  });

  // previousEpochParticipation and currentEpochParticipation is created inside generateCachedState
  // 0 and 1 are fully participated
  const testCases: {name: string; attestingIndices: number[]; expected: phase0.Attestation[]}[] = [
    {name: "all validators are seen", attestingIndices: [0, 1], expected: []},
    {name: "all validators are NOT seen", attestingIndices: [2, 3], expected: [attestation]},
    {name: "one is seen and one is NOT", attestingIndices: [1, 2], expected: [attestation]},
  ];

  for (const {name, attestingIndices, expected} of testCases) {
    it(name, function () {
      pool.add(attestation, attestingIndices, committee);
      expect(pool.getAttestationsForBlock(altairState)).to.be.deep.equal(expected, "incorrect returned attestations");
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

describe("MatchingDataAttestationGroup", function () {
  let attestationGroup: MatchingDataAttestationGroup;
  const committee = [100, 200, 300];
  const attestationSeed = generateEmptyAttestation();
  const attestationDataRoot = ssz.phase0.AttestationData.serialize(attestationSeed.data);
  let sk1: SecretKey;
  const attestation1 = {...attestationSeed, ...{aggregationBits: [true, true, false] as List<boolean>}};

  before(async () => {
    await initBLS();
    sk1 = bls.SecretKey.fromBytes(Buffer.alloc(32, 1));
    attestation1.signature = sk1.sign(attestationDataRoot).toBytes();
  });

  beforeEach(() => {
    attestationGroup = new MatchingDataAttestationGroup(committee, attestation1.data);
    attestationGroup.add({
      attestation: attestation1,
      attestingIndices: new Set([100, 200]),
    });
  });

  it("add - new data, getAttestations() return 2", () => {
    const attestation2 = {...attestationSeed, ...{aggregationBits: [true, false, true] as List<boolean>}};
    const result = attestationGroup.add({attestation: attestation2, attestingIndices: new Set([100, 300])});
    expect(result).to.be.equal(InsertOutcome.NewData, "incorrect InsertOutcome");
    const attestations = attestationGroup.getAttestations();
    expect(attestations).to.be.deep.equal([attestation1, attestation2], "Incorrect attestations for block");
  });

  it("add - new data, remove existing attestation, getAttestations() return 1", () => {
    const attestation2 = {...attestationSeed, ...{aggregationBits: [true, true, true] as List<boolean>}};
    const result = attestationGroup.add({attestation: attestation2, attestingIndices: new Set(committee)});
    expect(result).to.be.equal(InsertOutcome.NewData, "incorrect InsertOutcome");
    const attestations = attestationGroup.getAttestations();
    expect(attestations).to.be.deep.equal([attestation2], "should return only new attestation");
  });

  it("add - already known, getAttestations() return 1", () => {
    const attestation2 = {...attestationSeed, ...{aggregationBits: [true, false, false] as List<boolean>}};
    // attestingIndices is subset of an existing one
    const result = attestationGroup.add({attestation: attestation2, attestingIndices: new Set([100])});
    expect(result).to.be.equal(InsertOutcome.AlreadyKnown, "incorrect InsertOutcome");
    const attestations = attestationGroup.getAttestations();
    expect(attestations).to.be.deep.equal([attestation1], "expect exactly 1 attestation");
  });

  it("add - aggregate into existing attestation, getAttestations() return 1", () => {
    const attestation2 = {...attestationSeed, ...{aggregationBits: [false, false, true] as List<boolean>}};
    const sk2 = bls.SecretKey.fromBytes(Buffer.alloc(32, 2));
    attestation2.signature = sk2.sign(attestationDataRoot).toBytes();
    const result = attestationGroup.add({attestation: attestation2, attestingIndices: new Set([300])});
    expect(result).to.be.equal(InsertOutcome.Aggregated, "incorrect InsertOutcome");
    const attestations = attestationGroup.getAttestations();
    expect(attestations.length).to.be.equal(1, "expect exactly 1 aggregated attestation");
    expect(attestations[0].aggregationBits).to.be.deep.equal([true, true, true], "incorrect aggregationBits");
    const aggregatedSignature = bls.Signature.fromBytes(
      attestations[0].signature.valueOf() as Uint8Array,
      undefined,
      true
    );
    expect(
      aggregatedSignature.verifyAggregate([sk1.toPublicKey(), sk2.toPublicKey()], attestationDataRoot)
    ).to.be.equal(true, "invalid aggregated signature");
    expect(attestations[0].data).to.be.deep.equal(attestation1.data, "incorrect AttestationData");
  });

  it("getAttestationsForBlock - return 0", () => {
    const attestations = attestationGroup.getAttestationsForBlock(new Set(committee));
    expect(attestations).to.be.deep.equal([], "all attesters are seen, should remove empty");
  });

  it("getAttestationsForBlock - return 1", () => {
    const attestations = attestationGroup.getAttestationsForBlock(new Set([200]));
    expect(attestations).to.be.deep.equal(
      [
        {
          attestation: attestation1,
          attestingIndices: new Set([100, 200]),
          notSeenAttesterCount: 1,
        },
      ],
      "incorrect attestations"
    );
  });

  it("getAttestationsForBlock - return 2", () => {
    const attestation2 = {...attestationSeed, ...{aggregationBits: [true, false, true] as List<boolean>}};
    const result = attestationGroup.add({attestation: attestation2, attestingIndices: new Set([100, 300])});
    expect(result).to.be.equal(InsertOutcome.NewData, "incorrect InsertOutcome");
    const attestations = attestationGroup.getAttestationsForBlock(new Set([200]));
    expect(attestations).to.be.deep.equal(
      [
        {
          attestation: attestation2,
          attestingIndices: new Set([100, 300]),
          notSeenAttesterCount: 2,
        },
        {
          attestation: attestation1,
          attestingIndices: new Set([100, 200]),
          notSeenAttesterCount: 1,
        },
      ],
      "incorrect attestations"
    );
  });

  it("getAttestations", () => {
    const attestation2 = {...attestationSeed, ...{aggregationBits: [true, false, true] as List<boolean>}};
    const result = attestationGroup.add({attestation: attestation2, attestingIndices: new Set([100, 300])});
    expect(result).to.be.equal(InsertOutcome.NewData, "incorrect InsertOutcome");
    const attestations = attestationGroup.getAttestations();
    expect(attestations).to.be.deep.equal([attestation1, attestation2]);
  });
});

describe("aggregateInto", function () {
  const attestationSeed = generateEmptyAttestation();
  const attestation1 = {...attestationSeed, ...{aggregationBits: [false, true] as List<boolean>}};
  const attestation2 = {...attestationSeed, ...{aggregationBits: [true, false] as List<boolean>}};
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
    const attWithIndex1 = {attestation: attestation1, attestingIndices: new Set([100])};
    const attWithIndex2 = {attestation: attestation2, attestingIndices: new Set([200])};
    aggregateInto(attWithIndex1, attWithIndex2);
    expect(attWithIndex1.attestingIndices).to.be.deep.equal(new Set([100, 200]), "invalid aggregated attestingIndices");
    expect(attWithIndex1.attestation.aggregationBits).to.be.deep.equal([true, true], "invalid aggregationBits");
    const aggregatedSignature = bls.Signature.fromBytes(
      attWithIndex1.attestation.signature.valueOf() as Uint8Array,
      undefined,
      true
    );
    expect(
      aggregatedSignature.verifyAggregate([sk1.toPublicKey(), sk2.toPublicKey()], attestationDataRoot)
    ).to.be.equal(true, "invalid aggregated signature");
  });
});
