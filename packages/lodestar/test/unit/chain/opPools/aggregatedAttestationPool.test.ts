import {bls, SecretKey} from "@chainsafe/bls";
import {initBLS} from "@chainsafe/lodestar-cli/src/util";
import {createIChainForkConfig, defaultChainConfig} from "@chainsafe/lodestar-config";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {List} from "@chainsafe/ssz";
import {expect} from "chai";
import {ssz} from "../../../../../types/lib/phase0";
import {
  AggregatedAttestationPool,
  aggregateInto,
  MatchingDataAttestationGroup,
} from "../../../../src/chain/opPools/aggregatedAttestationPool";
import {InsertOutcome} from "../../../../src/chain/opPools/types";
import {generateAttestation, generateEmptyAttestation} from "../../../utils/attestation";
import {generateCachedState} from "../../../utils/state";
// eslint-disable-next-line no-restricted-imports
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/phase0/block/processAttestation";
import {SinonStubFn} from "../../../utils/types";
import sinon from "sinon";
import {phase0} from "../../../../../types/lib";

describe("AggregatedAttestationPool", function () {
  let pool: AggregatedAttestationPool;
  const altairForkEpoch = 2020;
  const currentSlot = SLOTS_PER_EPOCH * (altairForkEpoch + 10);
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createIChainForkConfig(Object.assign({}, defaultChainConfig, {ALTAIR_FORK_EPOCH: altairForkEpoch}));
  let validateAttestationStub: SinonStubFn<typeof attestationUtils["validateAttestation"]>;
  const altairState = generateCachedState({slot: currentSlot}, config, true);
  const attestation = generateAttestation({data: {slot: currentSlot - 2}});

  before(async function () {
    await initBLS();
  });

  beforeEach(() => {
    validateAttestationStub = sinon.stub(attestationUtils, "validateAttestation");
    pool = new AggregatedAttestationPool();
  });

  this.afterEach(() => {
    sinon.restore();
  });

  const testCases: {name: string; attestingIndices: number[]; expected: phase0.Attestation[]}[] = [
    {name: "all validators are seen", attestingIndices: [0, 1], expected: []},
    {name: "all validators are NOT seen", attestingIndices: [2, 3], expected: [attestation]},
    {name: "one is seen and one is NOT", attestingIndices: [1, 2], expected: [attestation]},
  ];

  for (const {name, attestingIndices, expected} of testCases) {
    it(name, function () {
      validateAttestationStub.returns();
      const committee = [0, 1, 2, 3];
      pool.add(attestation, attestingIndices, committee);
      expect(pool.getAttestationsForBlock(altairState)).to.be.deep.equal(expected, "incorrect returned attestations");
    });
  }
});

describe("MatchingDataAttestationGroup", function () {
  let attestationGroup: MatchingDataAttestationGroup;
  const committee = [100, 200, 300];
  const attestationSeed = generateEmptyAttestation();
  const attestationDataRoot = ssz.AttestationData.serialize(attestationSeed.data);
  let sk1: SecretKey;
  const attestation1 = {...attestationSeed, ...{aggregationBits: [true, true, false] as List<boolean>}};

  before(async () => {
    await initBLS();
    sk1 = bls.SecretKey.fromBytes(Buffer.alloc(32, 1));
    attestation1.signature = sk1.sign(attestationDataRoot).toBytes();
  });

  beforeEach(() => {
    attestationGroup = new MatchingDataAttestationGroup(committee);
    attestationGroup.add({
      attestation: attestation1,
      attestingIndices: [100, 200],
    });
  });

  it("add - new data, getAttestations() return 2", () => {
    const attestation2 = {...attestationSeed, ...{aggregationBits: [true, true, true] as List<boolean>}};
    const result = attestationGroup.add({attestation: attestation2, attestingIndices: committee});
    expect(result).to.be.equal(InsertOutcome.NewData, "incorrect InsertOutcome");
    const attestations = attestationGroup.getAttestations();
    // attestation2 should be first since it has more attesters there
    expect(attestations).to.be.deep.equal([attestation2, attestation1], "Incorrect attestations for block");
  });

  it("add - already known, getAttestations() return 1", () => {
    const attestation2 = {...attestationSeed, ...{aggregationBits: [true, false, false] as List<boolean>}};
    // attestingIndices is subset of an existing one
    const result = attestationGroup.add({attestation: attestation2, attestingIndices: [100]});
    expect(result).to.be.equal(InsertOutcome.AlreadyKnown, "incorrect InsertOutcome");
    const attestations = attestationGroup.getAttestations();
    expect(attestations).to.be.deep.equal([attestation1], "expect exactly 1 attestation");
  });

  it("add - aggregate into existing attestation, getAttestations() return 1", () => {
    const attestation2 = {...attestationSeed, ...{aggregationBits: [false, false, true] as List<boolean>}};
    const sk2 = bls.SecretKey.fromBytes(Buffer.alloc(32, 2));
    attestation2.signature = sk2.sign(attestationDataRoot).toBytes();
    const result = attestationGroup.add({attestation: attestation2, attestingIndices: [300]});
    expect(result).to.be.equal(InsertOutcome.Aggregated, "incorrect InsertOutcome");
    const attestations = attestationGroup.getAttestations();
    expect(attestations.length).to.be.equal(1, "expect exactly 1 aggregated attestation");
    expect(attestations[0].aggregationBits).to.be.deep.equal([true, true, true], "incorrect aggregationBits");
    const aggregatedSignature = bls.Signature.fromBytes(attestations[0].signature.valueOf() as Uint8Array);
    expect(
      aggregatedSignature.verifyAggregate([sk1.toPublicKey(), sk2.toPublicKey()], attestationDataRoot)
    ).to.be.equal(true, "invalid aggregated signature");
    expect(attestations[0].data).to.be.deep.equal(attestation1.data, "incorrect AttestationData");
  });

  it("removeIncluded - numRemoved is 0", () => {
    const numRemoved = attestationGroup.removeBySeenValidators([200]);
    expect(numRemoved).to.be.equal(0, "expect no attestation is removed");
    const attestations = attestationGroup.getAttestations();
    expect(attestations).to.be.deep.equal([attestation1], "incorrect getAttestations() result");
  });

  it("removeIncluded - numRemoved is 1", () => {
    const numRemoved = attestationGroup.removeBySeenValidators(committee);
    expect(numRemoved).to.be.equal(1, "expect exactly 1 attestation is removed");
    expect(attestationGroup.getAttestations()).to.be.deep.equal([], "the resulted attestations should be empty");
  });

  it("getAttestations - order by number of fresh attesters", () => {
    const attestation2 = {...attestationSeed, ...{aggregationBits: [true, false, true] as List<boolean>}};
    const result = attestationGroup.add({attestation: attestation2, attestingIndices: [100, 300]});
    expect(result).to.be.equal(InsertOutcome.NewData, "incorrect InsertOutcome");
    const numRemoved = attestationGroup.removeBySeenValidators([300]);
    expect(numRemoved).to.be.equal(0, "expect no attestation is removed");
    // attestation1 has 2 fresh attesters, attestation 2 has 1 fresh attesters
    expect(attestationGroup.getAttestations()).to.be.deep.equal(
      [attestation1, attestation2],
      "incorrect getAttestations() result"
    );
  });
});

describe("aggregateInto", function () {
  const attestationSeed = generateEmptyAttestation();
  const attestation1 = {...attestationSeed, ...{aggregationBits: [false, true] as List<boolean>}};
  const attestation2 = {...attestationSeed, ...{aggregationBits: [true, false] as List<boolean>}};
  const attestationDataRoot = ssz.AttestationData.serialize(attestationSeed.data);
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
    const committee = [100, 200];
    const attWithIndex1 = {attestation: attestation1, attestingIndices: [100]};
    const attWithIndex2 = {attestation: attestation2, attestingIndices: [200]};
    aggregateInto(attWithIndex1, attWithIndex2, committee);
    expect(attWithIndex1.attestingIndices).to.be.deep.equal([100, 200], "invalid aggregated attestingIndices");
    expect(attWithIndex1.attestation.aggregationBits).to.be.deep.equal([true, true], "invalid aggregationBits");
    const aggregatedSignature = bls.Signature.fromBytes(attWithIndex1.attestation.signature.valueOf() as Uint8Array);
    expect(
      aggregatedSignature.verifyAggregate([sk1.toPublicKey(), sk2.toPublicKey()], attestationDataRoot)
    ).to.be.equal(true, "invalid aggregated signature");
  });
});
