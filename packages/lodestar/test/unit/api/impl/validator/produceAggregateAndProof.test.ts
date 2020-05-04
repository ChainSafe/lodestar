import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {IValidatorApi, ValidatorApi} from "../../../../../src/api/impl/validator";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {AttestationRepository} from "../../../../../src/db/api/beacon/repositories";
import {PrivateKey, verifyAggregate} from "@chainsafe/bls";
import {Attestation} from "@chainsafe/lodestar-types";
import {computeDomain, computeSigningRoot, DomainType} from "@chainsafe/lodestar-beacon-state-transition";
import {expect} from "chai";


describe("produce aggregate and proof api implementation", function () {

  const sandbox = sinon.createSandbox();

  let attestationStub: SinonStubbedInstance<AttestationRepository>;
  
  let api: IValidatorApi;

  beforeEach(function () {
    attestationStub = sinon.createStubInstance(AttestationRepository);
    // @ts-ignore
    api = new ValidatorApi({}, {db: {attestation: attestationStub, getValidatorIndex: () => 1}, config});
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should get aggregated attestation", async function () {
    attestationStub.getCommiteeAttestations.resolves([
      getCommitteeAttestation(generateEmptyAttestation(), PrivateKey.fromInt(1), 1),
      getCommitteeAttestation(generateEmptyAttestation(), PrivateKey.fromInt(2), 2)
    ]);
    const result = await api.produceAggregateAndProof(generateEmptyAttestation().data, Buffer.alloc(48));
    expect(result.aggregate.signature).to.not.be.null;
    expect(result.aggregate.aggregationBits[0]).to.be.false;
    expect(result.aggregate.aggregationBits[1]).to.be.true;
    expect(result.aggregate.aggregationBits[2]).to.be.true;
    expect(verifyAggregate(
      [
        PrivateKey.fromInt(1).toPublicKey().toBytesCompressed(),
        PrivateKey.fromInt(2).toPublicKey().toBytesCompressed(),
      ],
      computeSigningRoot(
        config,
        config.types.AttestationData,
        generateEmptyAttestation().data,
        computeDomain(config, DomainType.BEACON_ATTESTER)
      ),
      result.aggregate.signature.valueOf() as Uint8Array
    )).to.be.true;
  });
    
});

function getCommitteeAttestation(attestation: Attestation, validator: PrivateKey, index: number): Attestation {
  attestation.signature = validator.signMessage(
    computeSigningRoot(
      config, config.types.AttestationData, attestation.data, computeDomain(config, DomainType.BEACON_ATTESTER)
    )
  ).toBytesCompressed();
  attestation.aggregationBits[index] = true;
  return attestation;
}
