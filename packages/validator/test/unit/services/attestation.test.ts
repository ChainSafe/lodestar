import {describe, it, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
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

vi.mock("../../../src/services/validatorStore.js");
vi.mock("../../../src/services/emitter.js");
vi.mock("../../../src/services/chainHeaderTracker.js");

describe("AttestationService", function () {
  const api = getApiClientStub();
  // @ts-expect-error - Mocked class don't need parameters
  const validatorStore = vi.mocked(new ValidatorStore());
  const emitter = vi.mocked(new ValidatorEventEmitter());
  // @ts-expect-error - Mocked class don't need parameters
  const chainHeadTracker = vi.mocked(new ChainHeaderTracker());

  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  beforeAll(() => {
    const secretKeys = Array.from({length: 1}, (_, i) => bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore.votingPubkeys.mockReturnValue(pubkeys.map(toHexString));
    validatorStore.hasVotingPubkey.mockReturnValue(true);
    validatorStore.hasSomeValidators.mockReturnValue(true);
    validatorStore.signAttestationSelectionProof.mockResolvedValue(ZERO_HASH);
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => {
    controller = new AbortController();
  });
  afterEach(() => {
    controller.abort();
    vi.resetAllMocks();
  });

  const testContexts: [string, AttestationServiceOpts][] = [
    ["With default configuration", {}],
    ["With attestation grouping disabled", {disableAttestationGrouping: true}],
    ["With distributed aggregation selection enabled", {distributedAggregationSelection: true}],
  ];

  for (const [title, opts] of testContexts) {
    describe(title, () => {
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
        api.beacon.getStateValidators.mockResolvedValue({
          response: {executionOptimistic: false, data: []},
          ok: true,
          status: HttpStatusCode.OK,
        });
        api.validator.getAttesterDuties.mockResolvedValue({
          response: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false, data: []},
          ok: true,
          status: HttpStatusCode.OK,
        });

        // Mock duties service to return some duties directly
        vi.spyOn(attestationService["dutiesService"], "getDutiesAtSlot").mockImplementation(() => duties);

        // Mock beacon's attestation and aggregates endpoints
        api.validator.produceAttestationData.mockResolvedValue({
          response: {data: attestation.data},
          ok: true,
          status: HttpStatusCode.OK,
        });
        api.validator.getAggregatedAttestation.mockResolvedValue({
          response: {data: attestation},
          ok: true,
          status: HttpStatusCode.OK,
        });
        api.beacon.submitPoolAttestations.mockResolvedValue({
          response: undefined,
          ok: true,
          status: HttpStatusCode.OK,
        });
        api.validator.publishAggregateAndProofs.mockResolvedValue({
          response: undefined,
          ok: true,
          status: HttpStatusCode.OK,
        });

        if (opts.distributedAggregationSelection) {
          // Mock distributed validator middleware client selections endpoint
          // and return a selection proof that passes `is_aggregator` test
          api.validator.submitBeaconCommitteeSelections.mockResolvedValue({
            response: {data: [{validatorIndex: 0, slot: 0, selectionProof: Buffer.alloc(1, 0x10)}]},
            ok: true,
            status: HttpStatusCode.OK,
          });
          // Accept all subscriptions
          api.validator.prepareBeaconCommitteeSubnet.mockResolvedValue({
            response: undefined,
            ok: true,
            status: HttpStatusCode.OK,
          });
        }

        // Mock signing service
        validatorStore.signAttestation.mockResolvedValue(attestation);
        validatorStore.signAggregateAndProof.mockResolvedValue(aggregate);

        // Trigger clock onSlot for slot 0
        await clock.tickSlotFns(0, controller.signal);

        if (opts.distributedAggregationSelection) {
          // Must submit partial beacon committee selection proof based on duty
          const selection: routes.validator.BeaconCommitteeSelection = {
            validatorIndex: 0,
            slot: 0,
            selectionProof: ZERO_HASH,
          };
          expect(api.validator.submitBeaconCommitteeSelections).toHaveBeenCalledOnce();
          expect(api.validator.submitBeaconCommitteeSelections).toHaveBeenCalledWith([selection]);

          // Must resubscribe validator as aggregator on beacon committee subnet
          const subscription: routes.validator.BeaconCommitteeSubscription = {
            validatorIndex: 0,
            committeeIndex: 0,
            committeesAtSlot: 120,
            slot: 0,
            isAggregator: true,
          };
          expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledOnce();
          expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledWith([subscription]);
        }

        // Must submit the attestation received through produceAttestationData()
        expect(api.beacon.submitPoolAttestations).toHaveBeenCalledOnce();
        expect(api.beacon.submitPoolAttestations).toHaveBeenCalledWith([attestation]);

        // Must submit the aggregate received through getAggregatedAttestation() then createAndSignAggregateAndProof()
        expect(api.validator.publishAggregateAndProofs).toHaveBeenCalledOnce();
        expect(api.validator.publishAggregateAndProofs).toHaveBeenCalledWith([aggregate]);
      });
    });
  }
});
