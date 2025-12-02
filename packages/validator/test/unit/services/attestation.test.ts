import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/blst";
import {toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {ChainConfig, createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {AttestationService, AttestationServiceOpts} from "../../../src/services/attestation.js";
import {AttDutyAndProof} from "../../../src/services/attestationDuties.js";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {ValidatorEventEmitter} from "../../../src/services/emitter.js";
import {SyncingStatusTracker} from "../../../src/services/syncingStatusTracker.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {ClockMock} from "../../utils/clock.js";
import {loggerVc} from "../../utils/logger.js";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../utils/types.js";

vi.mock("../../../src/services/validatorStore.js");
vi.mock("../../../src/services/emitter.js");
vi.mock("../../../src/services/chainHeaderTracker.js");
vi.mock("../../../src/services/syncingStatusTracker.js");

describe("AttestationService", () => {
  const api = getApiClientStub();
  // @ts-expect-error - Mocked class don't need parameters
  const validatorStore = vi.mocked(new ValidatorStore({}, {defaultConfig: {}}));
  const emitter = vi.mocked(new ValidatorEventEmitter());
  // @ts-expect-error - Mocked class don't need parameters
  const chainHeadTracker = vi.mocked(new ChainHeaderTracker());
  // @ts-expect-error - Mocked class don't need parameters
  const syncingStatusTracker = vi.mocked(new SyncingStatusTracker({}, api, new ClockMock(), null));

  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  let controller: AbortController; // To stop clock
  beforeEach(() => {
    controller = new AbortController();
    const secretKeys = Array.from({length: 1}, (_, i) => SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());

    // vi.mock does not automock all objects in Bun runtime, so we have to explicitly spy on needed methods
    vi.spyOn(validatorStore, "votingPubkeys");
    vi.spyOn(validatorStore, "hasVotingPubkey");
    vi.spyOn(validatorStore, "hasSomeValidators");
    vi.spyOn(validatorStore, "signAttestationSelectionProof");
    vi.spyOn(validatorStore, "signAttestation");
    vi.spyOn(validatorStore, "signAggregateAndProof");

    validatorStore.votingPubkeys.mockReturnValue(pubkeys.map(toHexString));
    validatorStore.hasVotingPubkey.mockReturnValue(true);
    validatorStore.hasSomeValidators.mockReturnValue(true);
    validatorStore.signAttestationSelectionProof.mockResolvedValue(ZERO_HASH);
  });
  afterEach(() => {
    controller.abort();
    vi.resetAllMocks();
  });

  const electraConfig: Partial<ChainConfig> = {ELECTRA_FORK_EPOCH: 0};

  const testContexts: [string, AttestationServiceOpts, Partial<ChainConfig>][] = [
    ["With default configuration", {}, {}],
    ["With default configuration post-electra", {}, electraConfig],
    ["With distributed aggregation selection enabled", {distributedAggregationSelection: true}, {}],
  ];

  for (const [title, opts, chainConfig] of testContexts) {
    describe(title, () => {
      it("Should produce, sign, and publish an attestation + aggregate", async () => {
        const clock = new ClockMock();
        const config = createChainForkConfig({...defaultConfig, ...chainConfig});
        const isPostElectra = chainConfig.ELECTRA_FORK_EPOCH === 0;
        const attestationService = new AttestationService(
          loggerVc,
          api,
          clock,
          validatorStore,
          emitter,
          chainHeadTracker,
          syncingStatusTracker,
          null,
          config,
          opts
        );

        const singleAttestation = isPostElectra
          ? ssz.electra.SingleAttestation.defaultValue()
          : ssz.phase0.Attestation.defaultValue();
        const aggregatedAttestation = isPostElectra
          ? ssz.electra.Attestation.defaultValue()
          : ssz.phase0.Attestation.defaultValue();
        const aggregateAndProof = isPostElectra
          ? ssz.electra.SignedAggregateAndProof.defaultValue()
          : ssz.phase0.SignedAggregateAndProof.defaultValue();
        const duties: AttDutyAndProof[] = [
          {
            duty: {
              slot: 0,
              committeeIndex: singleAttestation.data.index,
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
        api.beacon.postStateValidators.mockResolvedValue(
          mockApiResponse({data: [], meta: {executionOptimistic: false, finalized: false}})
        );
        api.validator.getAttesterDuties.mockResolvedValue(
          mockApiResponse({data: [], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
        );

        // Mock duties service to return some duties directly
        vi.spyOn(attestationService["dutiesService"], "getDutiesAtSlot").mockImplementation(() => duties);

        // Mock beacon's attestation and aggregates endpoints
        api.validator.produceAttestationData.mockResolvedValue(mockApiResponse({data: singleAttestation.data}));
        api.validator.getAggregatedAttestationV2.mockResolvedValue(
          mockApiResponse({data: aggregatedAttestation, meta: {version: ForkName.electra}})
        );
        api.beacon.submitPoolAttestationsV2.mockResolvedValue(mockApiResponse({}));
        api.validator.publishAggregateAndProofsV2.mockResolvedValue(mockApiResponse({}));

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
        validatorStore.signAttestation.mockResolvedValue(singleAttestation);
        validatorStore.signAggregateAndProof.mockResolvedValue(aggregateAndProof);

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
        expect(api.beacon.submitPoolAttestationsV2).toHaveBeenCalledOnce();
        expect(api.beacon.submitPoolAttestationsV2).toHaveBeenCalledWith({signedAttestations: [singleAttestation]});

        // Must submit the aggregate received through getAggregatedAttestationV2() then createAndSignAggregateAndProof()
        expect(api.validator.publishAggregateAndProofsV2).toHaveBeenCalledOnce();
        expect(api.validator.publishAggregateAndProofsV2).toHaveBeenCalledWith({
          signedAggregateAndProofs: [aggregateAndProof],
        });
      });
    });
  }
});
