import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {IValidatorApi, ValidatorApi} from "../../../../../src/api/impl/validator";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {PrivateKey, verifyAggregate} from "@chainsafe/bls";
import {Attestation} from "@chainsafe/lodestar-types";
import {computeDomain, computeSigningRoot, DomainType, EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {expect} from "chai";
import {BeaconChain, IBeaconChain} from "../../../../../src/chain";
import {generateState} from "../../../../utils/state";
import {generateValidator} from "../../../../utils/validator";
import {StubbedBeaconDb} from "../../../../utils/stub";


describe("produce aggregate and proof api implementation", function () {

  const sandbox = sinon.createSandbox();

  let dbStub: StubbedBeaconDb;
  let chainStub: SinonStubbedInstance<IBeaconChain>;

  let api: IValidatorApi;

  beforeEach(function () {
    chainStub = sinon.createStubInstance(BeaconChain);
    dbStub = new StubbedBeaconDb(sinon, config);

    api = new ValidatorApi(
      {},
      // @ts-ignore
      {
        chain: chainStub,
        db: dbStub,
        config
      }
    );
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should get aggregated attestation", async function () {
    dbStub.attestation.getCommiteeAttestations.resolves([
      getCommitteeAttestation(generateEmptyAttestation(), PrivateKey.fromInt(1), 1),
      getCommitteeAttestation(generateEmptyAttestation(), PrivateKey.fromInt(2), 2)
    ]);
    const state = generateState({
      validators: [
        generateValidator({
          pubkey: Buffer.alloc(48, 0)
        }),
      ]
    });
    const epochCtx = new EpochContext(config);
    epochCtx.syncPubkeys(state);
    chainStub.getHeadEpochContext.resolves(epochCtx);

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
