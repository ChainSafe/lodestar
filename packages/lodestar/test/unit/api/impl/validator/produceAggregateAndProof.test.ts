import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {IValidatorApi, ValidatorApi} from "../../../../../src/api/impl/validator";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {AttestationOperations} from "../../../../../src/opPool";
import {PrivateKey, verifyAggregate} from "@chainsafe/bls";
import {Attestation} from "@chainsafe/lodestar-types";
import {computeDomain, computeSigningRoot, DomainType} from "@chainsafe/lodestar-beacon-state-transition";
import { expect } from "chai";


describe("get proposers api impl", function () {

  const sandbox = sinon.createSandbox();

  let attestationsPoolStub: SinonStubbedInstance<AttestationOperations>;
  
  let api: IValidatorApi;

  beforeEach(function () {
    attestationsPoolStub = sinon.createStubInstance(AttestationOperations);
    // @ts-ignore
    api = new ValidatorApi({}, {opPool: {attestations: attestationsPoolStub}, config});
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should get aggregated attestation", async function () {
    attestationsPoolStub.getCommiteeAttestations.resolves([
        getCommitteeAttestation(generateEmptyAttestation(), PrivateKey.fromInt(1), 1),
        getCommitteeAttestation(generateEmptyAttestation(), PrivateKey.fromInt(2), 2)
    ]);
    const result = await api.produceAggregatedAttestation(generateEmptyAttestation().data);
    expect(result.signature).to.not.be.null;
    expect(result.aggregationBits[0]).to.be.false;
    expect(result.aggregationBits[1]).to.be.true;
    expect(result.aggregationBits[2]).to.be.true;
    expect(verifyAggregate(
        [
            PrivateKey.fromInt(1).toPublicKey().toBytesCompressed(),
            PrivateKey.fromInt(2).toPublicKey().toBytesCompressed(),
        ],
        computeSigningRoot(config, config.types.AttestationData, generateEmptyAttestation().data, computeDomain(config, DomainType.BEACON_ATTESTER)),
        result.signature.valueOf() as Uint8Array
    )).to.be.true;
  });
    
});

function getCommitteeAttestation(attestation: Attestation, validator: PrivateKey, index: number): Attestation {
    attestation.signature = validator.signMessage(
        computeSigningRoot(config, config.types.AttestationData, attestation.data, computeDomain(config, DomainType.BEACON_ATTESTER))
    ).toBytesCompressed();
    attestation.aggregationBits[index] = true;
    return attestation;
}