import {describe, it, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {SecretKey} from "@chainsafe/blst";
import {ssz} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {ChainConfig, createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {AttestationService, AttestationServiceOpts} from "../../../src/services/attestation.js";
import {AttDutyAndProof} from "../../../src/services/attestationDuties.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {SyncingStatusTracker} from "../../../src/services/syncingStatusTracker.js";
import {ValidatorEventEmitter} from "../../../src/services/emitter.js";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../utils/types.js";

vi.mock("../../../src/services/validatorStore.js");
vi.mock("../../../src/services/emitter.js");
vi.mock("../../../src/services/chainHeaderTracker.js");
vi.mock("../../../src/services/syncingStatusTracker.js");

describe("AttestationService", () => {
  const api = getApiClientStub();
  // @ts-expect-error - Mocked class don't need parameters
  const validatorStore = vi.mocked(new ValidatorStore());
  const emitter = vi.mocked(new ValidatorEventEmitter());
  // @ts-expect-error - Mocked class don't need parameters
  const chainHeadTracker = vi.mocked(new ChainHeaderTracker());
  // @ts-expect-error - Mocked class don't need parameters
  const syncingStatusTracker = vi.mocked(new SyncingStatusTracker());

  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  beforeAll(() => {
    const secretKeys = Array.from({length: 1}, (_, i) => SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
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

  const electraConfig: Partial<ChainConfig> = {ELECTRA_FORK_EPOCH: 0};

  const testContexts: [string, AttestationServiceOpts, Partial<ChainConfig>][] = [
    ["With default configuration", {}, {}],
    ["With default configuration post-electra", {}, electraConfig],
    ["With attestation grouping disabled", {disableAttestationGrouping: true}, {}],
    ["With attestation grouping disabled post-electra", {disableAttestationGrouping: true}, electraConfig],
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

        const attestation = isPostElectra
          ? ssz.electra.Attestation.defaultValue()
          : ssz.phase0.Attestation.defaultValue();
        const aggregate = isPostElectra
          ? ssz.electra.SignedAggregateAndProof.defaultValue()
          : ssz.phase0.SignedAggregateAndProof.defaultValue();
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
        api.beacon.postStateValidators.mockResolvedValue(
          mockApiResponse({data: [], meta: {executionOptimistic: false, finalized: false}})
        );
        api.validator.getAttesterDuties.mockResolvedValue(
          mockApiResponse({data: [], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
        );

        // Mock duties service to return some duties directly
        vi.spyOn(attestationService["dutiesService"], "getDutiesAtSlot").mockImplementation(() => duties);

        // Mock beacon's attestation and aggregates endpoints
        api.validator.produceAttestationData.mockResolvedValue(mockApiResponse({data: attestation.data}));
        if (isPostElectra) {
          api.validator.getAggregatedAttestationV2.mockResolvedValue(
            mockApiResponse({data: attestation, meta: {version: ForkName.electra}})
          );
          api.beacon.submitPoolAttestationsV2.mockResolvedValue(mockApiResponse({}));
          api.validator.publishAggregateAndProofsV2.mockResolvedValue(mockApiResponse({}));
        } else {
          api.validator.getAggregatedAttestation.mockResolvedValue(mockApiResponse({data: attestation}));
          api.beacon.submitPoolAttestations.mockResolvedValue(mockApiResponse({}));
          api.validator.publishAggregateAndProofs.mockResolvedValue(mockApiResponse({}));
        }

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

        if (isPostElectra) {
          // Must submit the attestation received through produceAttestationData()
          expect(api.beacon.submitPoolAttestationsV2).toHaveBeenCalledOnce();
          expect(api.beacon.submitPoolAttestationsV2).toHaveBeenCalledWith({signedAttestations: [attestation]});

          // Must submit the aggregate received through getAggregatedAttestationV2() then createAndSignAggregateAndProof()
          expect(api.validator.publishAggregateAndProofsV2).toHaveBeenCalledOnce();
          expect(api.validator.publishAggregateAndProofsV2).toHaveBeenCalledWith({
            signedAggregateAndProofs: [aggregate],
          });
        } else {
          // Must submit the attestation received through produceAttestationData()
          expect(api.beacon.submitPoolAttestations).toHaveBeenCalledOnce();
          expect(api.beacon.submitPoolAttestations).toHaveBeenCalledWith({signedAttestations: [attestation]});

          // Must submit the aggregate received through getAggregatedAttestation() then createAndSignAggregateAndProof()
          expect(api.validator.publishAggregateAndProofs).toHaveBeenCalledOnce();
          expect(api.validator.publishAggregateAndProofs).toHaveBeenCalledWith({signedAggregateAndProofs: [aggregate]});
        }
      });
    });
  }
});
