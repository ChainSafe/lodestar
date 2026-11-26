import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {HttpStatusCode} from "@lodestar/api";
import {ChainConfig, createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {SecretKey} from "@lodestar/native/blst";
import {ForkName, ForkSeq} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {AttestationService, AttestationServiceOpts} from "../../../src/services/attestation.js";
import {AttDutyAndProof} from "../../../src/services/attestationDuties.js";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {ValidatorEventEmitter} from "../../../src/services/emitter.js";
import {SyncingStatusTracker} from "../../../src/services/syncingStatusTracker.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "../../utils/apiStub.js";
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
  const gloasConfig: Partial<ChainConfig> = {GLOAS_FORK_EPOCH: 0};

  const testContexts: [string, AttestationServiceOpts, Partial<ChainConfig>][] = [
    ["With default configuration", {}, {}],
    ["With default configuration post-electra", {}, electraConfig],
    ["With default configuration post-gloas", {}, gloasConfig],
  ];

  for (const [title, opts, chainConfig] of testContexts) {
    describe(title, () => {
      it("Should produce, sign, and publish an attestation + aggregate", async () => {
        const slot = 0;
        const clock = new ClockMock();
        const config = createChainForkConfig({...defaultConfig, ...chainConfig});
        const isPostElectra = config.getForkSeq(slot) >= ForkSeq.electra;
        const isPostGloas = config.getForkSeq(slot) >= ForkSeq.gloas;
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
        if (isPostGloas) {
          singleAttestation.data.index = 1;
        }
        const aggregatedAttestation = isPostElectra
          ? ssz.electra.Attestation.defaultValue()
          : ssz.phase0.Attestation.defaultValue();
        const aggregateAndProof = isPostElectra
          ? ssz.electra.SignedAggregateAndProof.defaultValue()
          : ssz.phase0.SignedAggregateAndProof.defaultValue();
        const duties: AttDutyAndProof[] = [
          {
            duty: {
              slot,
              committeeIndex: 6,
              committeeLength: 120,
              committeesAtSlot: 120,
              validatorCommitteeIndex: 1,
              isAggregator: false,
              aggregatorPosition: 0,
              validatorIndex: 0,
              pubkey: pubkeys[0],
            },
            selectionProof: ZERO_HASH,
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
          mockApiResponse({data: aggregatedAttestation, meta: {version: config.getForkName(slot)}})
        );
        api.beacon.submitPoolAttestationsV2.mockResolvedValue(mockApiResponse({}));
        api.validator.publishAggregateAndProofsV2.mockResolvedValue(mockApiResponse({}));

        // Mock signing service
        validatorStore.signAttestation.mockResolvedValue(singleAttestation);
        validatorStore.signAggregateAndProof.mockResolvedValue(aggregateAndProof);

        // Trigger clock onSlot for slot 0
        await clock.tickSlotFns(slot, controller.signal);

        // Must submit the attestation received through produceAttestationData()
        expect(api.beacon.submitPoolAttestationsV2).toHaveBeenCalledOnce();
        expect(api.beacon.submitPoolAttestationsV2).toHaveBeenCalledWith({signedAttestations: [singleAttestation]});

        // Must submit the aggregate received through getAggregatedAttestationV2() then createAndSignAggregateAndProof()
        expect(api.validator.publishAggregateAndProofsV2).toHaveBeenCalledOnce();
        expect(api.validator.publishAggregateAndProofsV2).toHaveBeenCalledWith({
          signedAggregateAndProofs: [aggregateAndProof],
        });

        const expectedIndex = isPostGloas
          ? singleAttestation.data.index
          : isPostElectra
            ? 0
            : duties[0].duty.committeeIndex;

        expect(validatorStore.signAttestation).toHaveBeenCalledWith(
          duties[0].duty,
          expect.objectContaining({index: expectedIndex}),
          computeEpochAtSlot(slot)
        );
      });
    });
  }

  it("Should publish each pq attestation once it is signed, without waiting for the others", async () => {
    const slot = 0;
    const clock = new ClockMock();
    const config = createChainForkConfig({...defaultConfig, GLOAS_FORK_EPOCH: 0, PQ_FORK_EPOCH: 0});
    expect(config.getForkName(slot)).toBe(ForkName.pq);
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
      {}
    );

    const attestations = [0, 1].map((attesterIndex) => ({
      ...ssz.electra.SingleAttestation.defaultValue(),
      attesterIndex,
    }));
    const duties: AttDutyAndProof[] = attestations.map(({attesterIndex}) => ({
      duty: {
        slot,
        committeeIndex: 0,
        committeeLength: attestations.length,
        committeesAtSlot: 1,
        validatorCommitteeIndex: attesterIndex,
        isAggregator: false,
        aggregatorPosition: 0,
        validatorIndex: attesterIndex,
        pubkey: pubkeys[0],
      },
      selectionProof: null,
    }));

    api.beacon.postStateValidators.mockResolvedValue(
      mockApiResponse({data: [], meta: {executionOptimistic: false, finalized: false}})
    );
    api.validator.getAttesterDuties.mockResolvedValue(
      mockApiResponse({data: [], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );
    vi.spyOn(attestationService["dutiesService"], "getDutiesAtSlot").mockImplementation(() => duties);
    api.validator.produceAttestationData.mockResolvedValue(mockApiResponse({data: attestations[0].data}));
    api.beacon.submitPoolAttestationsV2.mockResolvedValue(mockApiResponse({}));

    // The second signature stays pending until the first attestation is seen published
    let finishSecondSignature: () => void = () => {};
    const secondSignature = new Promise<void>((resolve) => {
      finishSecondSignature = resolve;
    });
    validatorStore.signAttestation.mockImplementation(async (duty) => {
      if (duty.validatorIndex === 1) await secondSignature;
      return attestations[duty.validatorIndex];
    });

    const ticked = clock.tickSlotFns(slot, controller.signal);

    await vi.waitFor(() => {
      expect(api.beacon.submitPoolAttestationsV2).toHaveBeenCalledOnce();
    });
    expect(api.beacon.submitPoolAttestationsV2).toHaveBeenLastCalledWith({signedAttestations: [attestations[0]]});

    finishSecondSignature();
    await vi.waitFor(() => {
      expect(api.beacon.submitPoolAttestationsV2).toHaveBeenCalledTimes(2);
    });
    expect(api.beacon.submitPoolAttestationsV2).toHaveBeenLastCalledWith({signedAttestations: [attestations[1]]});

    // Stops the wait for the aggregation deadline
    controller.abort();
    await ticked;
  });

  describe("pq aggregation", () => {
    const slot = 0;
    const config = createChainForkConfig({...defaultConfig, GLOAS_FORK_EPOCH: 0, PQ_FORK_EPOCH: 0});
    const attestation = ssz.electra.SingleAttestation.defaultValue();
    const aggregate = ssz.pq.AggregatedAttestation.defaultValue();
    const signedAggregateAndProof = ssz.pq.SignedAggregateAndProof.defaultValue();
    // Two aggregators of one committee, the second of them first in the aggregation committee
    const aggregatorPositions = [2, 1];

    let duties: AttDutyAndProof[];
    let clock: ClockMock;

    beforeEach(() => {
      clock = new ClockMock();
      // Past every deadline of the slot, so that nothing waits
      vi.spyOn(clock, "msFromSlot").mockReturnValue(config.SLOT_DURATION_MS);
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
        {}
      );
      duties = aggregatorPositions.map((aggregatorPosition, validatorIndex) => ({
        duty: {
          slot,
          committeeIndex: 0,
          committeeLength: aggregatorPositions.length,
          committeesAtSlot: 1,
          validatorCommitteeIndex: validatorIndex,
          isAggregator: true,
          aggregatorPosition,
          validatorIndex,
          pubkey: pubkeys[0],
        },
        selectionProof: new Uint8Array(0),
      }));

      api.beacon.postStateValidators.mockResolvedValue(
        mockApiResponse({data: [], meta: {executionOptimistic: false, finalized: false}})
      );
      api.validator.getAttesterDuties.mockResolvedValue(
        mockApiResponse({data: [], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
      );
      vi.spyOn(attestationService["dutiesService"], "getDutiesAtSlot").mockImplementation(() => duties);
      api.validator.produceAttestationData.mockResolvedValue(mockApiResponse({data: attestation.data}));
      api.beacon.submitPoolAttestationsV2.mockResolvedValue(mockApiResponse({}));
      api.validator.publishAggregateAndProofsV2.mockResolvedValue(mockApiResponse({}));
      validatorStore.signAttestation.mockResolvedValue(attestation);
      validatorStore.signAggregateAndProof.mockResolvedValue(signedAggregateAndProof);
    });

    it("Should aggregate as the first of its aggregators of a committee, when that position is due", async () => {
      const getAggregateDueMs = vi.spyOn(config, "getAggregateDueMs");
      api.validator.getAggregatedAttestationV2.mockResolvedValue(
        mockApiResponse({data: aggregate, meta: {version: ForkName.pq}})
      );

      await clock.tickSlotFns(slot, controller.signal);

      expect(getAggregateDueMs).toHaveBeenCalledExactlyOnceWith(ForkName.pq, 1);
      expect(api.validator.getAggregatedAttestationV2).toHaveBeenCalledOnce();
      expect(validatorStore.signAggregateAndProof).toHaveBeenCalledExactlyOnceWith(
        duties[1].duty,
        duties[1].selectionProof,
        aggregate
      );
      expect(api.validator.publishAggregateAndProofsV2).toHaveBeenCalledExactlyOnceWith({
        signedAggregateAndProofs: [signedAggregateAndProof],
      });
    });

    it("Should publish no aggregate when the beacon node has none to publish", async () => {
      api.validator.getAggregatedAttestationV2.mockResolvedValue(
        await mockApiErrorResponse(HttpStatusCode.NOT_FOUND, {
          code: 404,
          message: "An aggregate seen includes every attester",
        })
      );

      await clock.tickSlotFns(slot, controller.signal);

      expect(api.validator.getAggregatedAttestationV2).toHaveBeenCalledOnce();
      expect(validatorStore.signAggregateAndProof).not.toHaveBeenCalled();
      expect(api.validator.publishAggregateAndProofsV2).not.toHaveBeenCalled();
    });
  });
});
