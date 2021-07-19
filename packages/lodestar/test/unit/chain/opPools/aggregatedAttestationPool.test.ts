import {bls} from "@chainsafe/bls";
import {List} from "@chainsafe/ssz";
import {expect} from "chai";
import {ssz} from "../../../../../types/lib/phase0";
import {aggregateInto, MatchingDataAttestationGroup} from "../../../../src/chain/opPools";
import {InsertOutcome} from "../../../../src/chain/opPools/types";
import {generateEmptyAttestation} from "../../../utils/attestation";

describe("MatchingDataAttestationGroup", function () {
  let attestationGroup: MatchingDataAttestationGroup;
  const committee = [100, 200, 300];
  const attestationSeed = generateEmptyAttestation();
  const attestationDataRoot = ssz.AttestationData.serialize(attestationSeed.data);

  const attestation1 = {...attestationSeed, ...{aggregationBits: [true, true, false] as List<boolean>}};
  const sk1 = bls.SecretKey.fromBytes(Buffer.alloc(32, 1));
  attestation1.signature = sk1.sign(attestationDataRoot).toBytes();
  beforeEach(() => {
    attestationGroup = new MatchingDataAttestationGroup(
      {
        attestation: attestation1,
        attestingIndices: [100, 200],
      },
      committee
    );
  });

  it("add - new data, getAttestations() return 2", () => {
    const attestation2 = {...attestationSeed, ...{aggregationBits: [true, true, true] as List<boolean>}};
    const result = attestationGroup.add({attestation: attestation2, attestingIndices: committee});
    expect(result).to.be.equal(InsertOutcome.NewData, "incorrect InsertOutcome");
    const attestations = attestationGroup.getAttestations();
    // attestation2 should be first since it has more attesters there
    expect(attestations).to.be.deep.equal([attestation2, attestation1], "Incorrect attestations for block");
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

  it("add - attestations are already known by chain", () => {
    const seenAttestation = {...attestationSeed, ...{aggregationBits: [false, false, true] as List<boolean>}};
    const numRemoved = attestationGroup.removeIncluded({attestation: seenAttestation, attestingIndices: [300]});
    expect(numRemoved).to.be.equal(0, "expect no attestation is removed");
    // same to seen attestation
    const attestation2 = {...seenAttestation};
    const result = attestationGroup.add({attestation: attestation2, attestingIndices: [300]});
    expect(result).to.be.equal(InsertOutcome.AlreadyKnown, "incorrect InsertOutcome");
  });

  // removeIncluded - numRemoved is 0: tested above

  it("removeIncluded - numRemoved is 1", () => {
    const seenAttestation = {...attestationSeed, ...{aggregationBits: [true, true, true] as List<boolean>}};
    const numRemoved = attestationGroup.removeIncluded({attestation: seenAttestation, attestingIndices: committee});
    expect(numRemoved).to.be.equal(1, "expect exactly 1 attestation is removed");
  });
});

describe("aggregateInto", function () {
  const attestationSeed = generateEmptyAttestation();
  const attestation1 = {...attestationSeed, ...{aggregationBits: [false, true] as List<boolean>}};
  const attestation2 = {...attestationSeed, ...{aggregationBits: [true, false] as List<boolean>}};
  const attestationDataRoot = ssz.AttestationData.serialize(attestationSeed.data);
  const sk1 = bls.SecretKey.fromBytes(Buffer.alloc(32, 1));
  const sk2 = bls.SecretKey.fromBytes(Buffer.alloc(32, 2));
  before("Init BLS", async () => {
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
