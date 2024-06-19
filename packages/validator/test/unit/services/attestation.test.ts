import {describe, it, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {AttestationService, AttestationServiceOpts} from "../../../src/services/attestation.js";
import {AttDutyAndProof} from "../../../src/services/attestationDuties.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
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
          createChainForkConfig(config),
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
        api.beacon.getStateValidators.mockResolvedValue(
          mockApiResponse({data: [], meta: {executionOptimistic: false, finalized: false}})
        );
        api.validator.getAttesterDuties.mockResolvedValue(
          mockApiResponse({data: [], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
        );

        // Mock duties service to return some duties directly
        vi.spyOn(attestationService["dutiesService"], "getDutiesAtSlot").mockImplementation(() => duties);

        // Mock beacon's attestation and aggregates endpoints
        api.validator.produceAttestationData.mockResolvedValue(mockApiResponse({data: attestation.data}));
        api.validator.getAggregatedAttestation.mockResolvedValue(
          mockApiResponse({data: attestation, meta: {version: ForkName.phase0}})
        );

        api.beacon.submitPoolAttestations.mockResolvedValue(mockApiResponse({}));
        api.validator.publishAggregateAndProofs.mockResolvedValue(mockApiResponse({}));

        if (opts.distributedAggregationSelection) {
          // Mock distributed validator middleware client selections endpoint
          // and return a selection proof that passes `is_aggregator` test
          api.validator.submitBeaconCommitteeSelections.mockResolvedValue(
            mockApiResponse({data: [{validatorIndex: 0, slot: 0, selectionProof: Buffer.alloc(1, 0x10)}]})
          );
          // Accept all subscriptions
          api.validator.prepareBeaconCommitteeSubnet.mockResolvedValue(mockApiResponse({}));
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
          expect(api.validator.submitBeaconCommitteeSelections).toHaveBeenCalledWith({selections: [selection]});

          // Must resubscribe validator as aggregator on beacon committee subnet
          const subscription: routes.validator.BeaconCommitteeSubscription = {
            validatorIndex: 0,
            committeeIndex: 0,
            committeesAtSlot: 120,
            slot: 0,
            isAggregator: true,
          };
          expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledOnce();
          expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledWith({subscriptions: [subscription]});
        }

        // Must submit the attestation received through produceAttestationData()
        expect(api.beacon.submitPoolAttestations).toHaveBeenCalledOnce();
        expect(api.beacon.submitPoolAttestations).toHaveBeenCalledWith({signedAttestations: [attestation]});

        // Must submit the aggregate received through getAggregatedAttestation() then createAndSignAggregateAndProof()
        expect(api.validator.publishAggregateAndProofs).toHaveBeenCalledOnce();
        expect(api.validator.publishAggregateAndProofs).toHaveBeenCalledWith({signedAggregateAndProofs: [aggregate]});
      });
    });
  }
});
