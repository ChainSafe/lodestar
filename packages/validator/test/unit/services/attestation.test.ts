import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {
  generateEmptyAttestation,
  generateEmptySignedAggregateAndProof,
} from "../../../../beacon-node/test/utils/attestation.js";
import {AttestationService} from "../../../src/services/attestation.js";
import {AttDutyAndProof} from "../../../src/services/attestationDuties.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {ValidatorEventEmitter} from "../../../src/services/emitter.js";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../utils/types.js";

describe("AttestationService", function () {
  const sandbox = sinon.createSandbox();

  const api = getApiClientStub(sandbox);
  const validatorStore = sinon.createStubInstance(ValidatorStore) as ValidatorStore &
    sinon.SinonStubbedInstance<ValidatorStore>;
  const emitter = sinon.createStubInstance(ValidatorEventEmitter) as ValidatorEventEmitter &
    sinon.SinonStubbedInstance<ValidatorEventEmitter>;
  const chainHeadTracker = sinon.createStubInstance(ChainHeaderTracker) as ChainHeaderTracker &
    sinon.SinonStubbedInstance<ChainHeaderTracker>;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  before(() => {
    const secretKeys = Array.from({length: 1}, (_, i) => bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore.votingPubkeys.returns(pubkeys.map(toHexString));
    validatorStore.hasVotingPubkey.returns(true);
    validatorStore.hasSomeValidators.returns(true);
    validatorStore.signAttestationSelectionProof.resolves(ZERO_HASH);
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  it("Should produce, sign, and publish an attestation + aggregate", async () => {
    const clock = new ClockMock();
    const attestationService = new AttestationService(
      loggerVc,
      api,
      clock,
      validatorStore,
      emitter,
      chainHeadTracker,
      null
    );

    const attestation = generateEmptyAttestation();
    const aggregate = generateEmptySignedAggregateAndProof();
    const duties: AttDutyAndProof[] = [
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
    api.beacon.getStateValidators.resolves({executionOptimistic: false, data: []});
    api.validator.getAttesterDuties.resolves({dependentRoot: ZERO_HASH_HEX, executionOptimistic: false, data: []});

    // Mock duties service to return some duties directly
    attestationService["dutiesService"].getDutiesAtSlot = sinon.stub().returns(duties);

    // Mock beacon's attestation and aggregates endpoints

    api.validator.produceAttestationData.resolves({data: attestation.data});
    api.validator.getAggregatedAttestation.resolves({data: attestation});
    api.beacon.submitPoolAttestations.resolves();
    api.validator.publishAggregateAndProofs.resolves();

    // Mock signing service
    validatorStore.signAttestation.resolves(attestation);
    validatorStore.signAggregateAndProof.resolves(aggregate);

    // Trigger clock onSlot for slot 0
    await clock.tickSlotFns(0, controller.signal);

    // Must submit the attestation received through produceAttestationData()
    expect(api.beacon.submitPoolAttestations.callCount).to.equal(1, "submitAttestations() must be called once");
    expect(api.beacon.submitPoolAttestations.getCall(0).args).to.deep.equal(
      [[attestation]], // 1 arg, = attestation[]
      "wrong submitAttestations() args"
    );

    // Must submit the aggregate received through getAggregatedAttestation() then createAndSignAggregateAndProof()
    expect(api.validator.publishAggregateAndProofs.callCount).to.equal(
      1,
      "publishAggregateAndProofs() must be called once"
    );
    expect(api.validator.publishAggregateAndProofs.getCall(0).args).to.deep.equal(
      [[aggregate]], // 1 arg, = aggregate[]
      "wrong publishAggregateAndProofs() args"
    );
  });
});
