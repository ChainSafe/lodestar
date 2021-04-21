import {AbortController} from "abort-controller";
import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {config as mainnetConfig} from "@chainsafe/lodestar-config/mainnet";
import {
  generateEmptyAttestation,
  generateEmptySignedAggregateAndProof,
} from "@chainsafe/lodestar/test/utils/attestation";
import {AttestationService} from "../../../src/services/attestation";
import {DutyAndProof} from "../../../src/services/attestationDuties";
import {ValidatorStore} from "../../../src/services/validatorStore";
import {Clock} from "../../../src/util/clock";
import {ApiClientStub} from "../../utils/apiStub";
import {testLogger} from "../../utils/logger";

describe("AttestationService", function () {
  const sandbox = sinon.createSandbox();
  const logger = testLogger();
  const ZERO_HASH = Buffer.alloc(32, 0);

  const apiClient = ApiClientStub(sandbox);
  const validatorStore = sinon.createStubInstance(ValidatorStore) as ValidatorStore &
    sinon.SinonStubbedInstance<ValidatorStore>;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  // Clone before mutating
  const config: typeof mainnetConfig = {...mainnetConfig, params: {...mainnetConfig.params}};
  config.params.SECONDS_PER_SLOT = 1 / 1000; // Make slot time super short: 1 ms
  config.params.SLOTS_PER_EPOCH = 3;

  before(() => {
    const secretKeys = Array.from({length: 1}, (_, i) => bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore.votingPubkeys.returns(pubkeys);
    validatorStore.produceSelectionProof.resolves(ZERO_HASH);
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  it("Should produce, sign, and publish an attestation + aggregate", async () => {
    const clock = new Clock(config, logger, {genesisTime: Date.now() / 1000});
    const attestationService = new AttestationService(config, logger, apiClient, clock, validatorStore);

    const attestation = generateEmptyAttestation();
    const aggregate = generateEmptySignedAggregateAndProof();
    const duties: DutyAndProof[] = [
      {
        duty: {
          slot: 0,
          committeeIndex: attestation.data.index,
          committeeLength: 120,
          committeesAtSlot: 120,
          validatorCommitteeIndex: 1,
          validatorIndex: 0,
          pubkey: pubkeys[0],
        },
        selectionProof: ZERO_HASH,
      },
    ];

    // Return empty replies to duties service
    apiClient.beacon.state.getStateValidators.resolves([]);
    apiClient.validator.getAttesterDuties.resolves({dependentRoot: ZERO_HASH, data: []});

    // Mock duties service to return some duties directly
    attestationService["dutiesService"].getAttestersAtSlot = sinon.stub().returns(duties);

    // Mock beacon's attestation and aggregates endpoints

    apiClient.validator.produceAttestationData.resolves(attestation.data);
    apiClient.validator.getAggregatedAttestation.resolves(attestation);
    apiClient.beacon.pool.submitAttestations.resolves();
    apiClient.validator.publishAggregateAndProofs.resolves();

    // Mock signing service
    validatorStore.createAndSignAttestation.resolves(attestation);
    validatorStore.createAndSignAggregateAndProof.resolves(aggregate);

    // Trigger clock onSlot for slot 0
    for (const fn of clock["fns"]) await fn.fn(0, controller.signal);

    // Must submit the attestation received through produceAttestationData()
    expect(apiClient.beacon.pool.submitAttestations.callCount).to.equal(1, "submitAttestations() must be called once");
    expect(apiClient.beacon.pool.submitAttestations.getCall(0).args).to.deep.equal(
      [[attestation]], // 1 arg, = attestation[]
      "wrong submitAttestations() args"
    );

    // Must submit the aggregate received through getAggregatedAttestation() then createAndSignAggregateAndProof()
    expect(apiClient.validator.publishAggregateAndProofs.callCount).to.equal(
      1,
      "publishAggregateAndProofs() must be called once"
    );
    expect(apiClient.validator.publishAggregateAndProofs.getCall(0).args).to.deep.equal(
      [[aggregate]], // 1 arg, = aggregate[]
      "wrong publishAggregateAndProofs() args"
    );
  });
});
