import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {HttpStatusCode, routes} from "@lodestar/api";
import {AttestationService, AttestationServiceOpts} from "../../../src/services/attestation.js";
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
  afterEach(() => {
    controller.abort();
    sandbox.resetHistory();
  });

  const testContexts: [string, AttestationServiceOpts][] = [
    ["With default configuration", {}],
    ["With attestation grouping disabled", {disableAttestationGrouping: true}],
    ["With distributed aggregation selection enabled", {distributedAggregationSelection: true}],
  ];

  for (const [title, opts] of testContexts) {
    context(title, () => {
      it("Should produce, sign, and publish an attestation + aggregate", async () => {
        const clock = new ClockMock();
        const attestationService = new AttestationService(
          loggerVc,
          api,
          clock,
          validatorStore,
          emitter,
          chainHeadTracker,
          null,
          opts
        );

        const attestation = ssz.phase0.Attestation.defaultValue();
        const aggregate = ssz.phase0.SignedAggregateAndProof.defaultValue();
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
            selectionProof: opts.distributedAggregationSelection ? null : ZERO_HASH,
            partialSelectionProof: opts.distributedAggregationSelection ? ZERO_HASH : undefined,
          },
        ];

        // Return empty replies to duties service
        api.beacon.getStateValidators.resolves({
          response: {executionOptimistic: false, data: []},
          ok: true,
          status: HttpStatusCode.OK,
        });
        api.validator.getAttesterDuties.resolves({
          response: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false, data: []},
          ok: true,
          status: HttpStatusCode.OK,
        });

        // Mock duties service to return some duties directly
        attestationService["dutiesService"].getDutiesAtSlot = sinon.stub().returns(duties);

        // Mock beacon's attestation and aggregates endpoints

        api.validator.produceAttestationData.resolves({
          response: {data: attestation.data},
          ok: true,
          status: HttpStatusCode.OK,
        });
        api.validator.getAggregatedAttestation.resolves({
          response: {data: attestation},
          ok: true,
          status: HttpStatusCode.OK,
        });
        api.beacon.submitPoolAttestations.resolves({
          response: undefined,
          ok: true,
          status: HttpStatusCode.OK,
        });
        api.validator.publishAggregateAndProofs.resolves({
          response: undefined,
          ok: true,
          status: HttpStatusCode.OK,
        });

        if (opts.distributedAggregationSelection) {
          // Mock distributed validator middleware client selections endpoint
          // and return a selection proof that passes `is_aggregator` test
          api.validator.submitBeaconCommitteeSelections.resolves({
            response: {data: [{validatorIndex: 0, slot: 0, selectionProof: Buffer.alloc(1, 0x10)}]},
            ok: true,
            status: HttpStatusCode.OK,
          });
          // Accept all subscriptions
          api.validator.prepareBeaconCommitteeSubnet.resolves({
            response: undefined,
            ok: true,
            status: HttpStatusCode.OK,
          });
        }

        // Mock signing service
        validatorStore.signAttestation.resolves(attestation);
        validatorStore.signAggregateAndProof.resolves(aggregate);

        // Trigger clock onSlot for slot 0
        await clock.tickSlotFns(0, controller.signal);

        if (opts.distributedAggregationSelection) {
          // Must submit partial beacon committee selection proof based on duty
          const selection: routes.validator.BeaconCommitteeSelection = {
            validatorIndex: 0,
            slot: 0,
            selectionProof: ZERO_HASH,
          };
          expect(api.validator.submitBeaconCommitteeSelections.callCount).to.equal(
            1,
            "submitBeaconCommitteeSelections() must be called once"
          );
          expect(api.validator.submitBeaconCommitteeSelections.getCall(0).args).to.deep.equal(
            [[selection]], // 1 arg, = selection[]
            "wrong submitBeaconCommitteeSelections() args"
          );

          // Must resubscribe validator as aggregator on beacon committee subnet
          const subscription: routes.validator.BeaconCommitteeSubscription = {
            validatorIndex: 0,
            committeeIndex: 0,
            committeesAtSlot: 120,
            slot: 0,
            isAggregator: true,
          };
          expect(api.validator.prepareBeaconCommitteeSubnet.callCount).to.equal(
            1,
            "prepareBeaconCommitteeSubnet() must be called once"
          );
          expect(api.validator.prepareBeaconCommitteeSubnet.getCall(0).args).to.deep.equal(
            [[subscription]], // 1 arg, = subscription[]
            "wrong prepareBeaconCommitteeSubnet() args"
          );
        }

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
  }
});
