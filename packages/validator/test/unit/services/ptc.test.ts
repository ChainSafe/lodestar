import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {gloas, ssz} from "@lodestar/types";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {ValidatorEventEmitter} from "../../../src/services/emitter.js";
import {PtcService} from "../../../src/services/ptc.js";
import {PtcDutiesService} from "../../../src/services/ptcDuties.js";
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

describe("PtcService", () => {
  const api = getApiClientStub();
  // @ts-expect-error - Mocked class doesn't need parameters
  const validatorStore = vi.mocked(new ValidatorStore({}, {defaultConfig: {}}));
  const emitter = vi.mocked(new ValidatorEventEmitter());
  // @ts-expect-error - Mocked class doesn't need parameters
  const chainHeadTracker = vi.mocked(new ChainHeaderTracker());
  // @ts-expect-error - Mocked class doesn't need parameters
  const syncingStatusTracker = vi.mocked(new SyncingStatusTracker({}, api, new ClockMock(), null));

  let pubkeys: Uint8Array[];
  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
    const secretKeys = Array.from({length: 1}, (_, i) => SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());

    vi.spyOn(validatorStore, "votingPubkeys");
    vi.spyOn(validatorStore, "getAllLocalIndices");
    vi.spyOn(validatorStore, "pollValidatorIndices");
    vi.spyOn(validatorStore, "hasVotingPubkey");
    vi.spyOn(validatorStore, "isDoppelgangerSafe");
    vi.spyOn(validatorStore, "hasSomeValidators");
    vi.spyOn(validatorStore, "signPayloadAttestation");
    vi.spyOn(emitter, "waitForExecutionPayloadAvailableSlot");

    validatorStore.votingPubkeys.mockReturnValue(pubkeys.map(toHexString));
    validatorStore.getAllLocalIndices.mockReturnValue([0]);
    validatorStore.pollValidatorIndices.mockResolvedValue([]);
    validatorStore.hasVotingPubkey.mockReturnValue(true);
    validatorStore.isDoppelgangerSafe.mockReturnValue(true);
    validatorStore.hasSomeValidators.mockReturnValue(true);
    emitter.waitForExecutionPayloadAvailableSlot.mockResolvedValue(undefined);
  });

  afterEach(() => {
    controller.abort();
    vi.resetAllMocks();
  });

  it("Should produce, sign, and publish payload attestation messages", async () => {
    const slot = 0;
    const clock = new ClockMock();
    const config = createChainForkConfig({...defaultConfig, GLOAS_FORK_EPOCH: 0});
    const ptcService = new PtcService(
      config,
      loggerVc,
      api,
      clock,
      validatorStore,
      emitter,
      chainHeadTracker,
      syncingStatusTracker,
      null
    );

    const duty: routes.validator.PtcDuty = {
      slot,
      validatorIndex: 0,
      pubkey: pubkeys[0],
    };
    const payloadAttestationData = ssz.gloas.PayloadAttestationData.defaultValue();
    const payloadAttestationMessage: gloas.PayloadAttestationMessage = {
      validatorIndex: duty.validatorIndex,
      data: payloadAttestationData,
      signature: ZERO_HASH,
    };

    vi.spyOn(ptcService["dutiesService"], "getDutiesAtSlot").mockReturnValue([duty]);
    api.validator.producePayloadAttestationData.mockResolvedValue(
      mockApiResponse({data: payloadAttestationData, meta: {version: config.getForkName(slot)}})
    );
    validatorStore.signPayloadAttestation.mockResolvedValue(payloadAttestationMessage);
    api.beacon.submitPayloadAttestationMessages.mockResolvedValue(mockApiResponse({}));

    await clock.tickSlotFns(slot, controller.signal);

    expect(emitter.waitForExecutionPayloadAvailableSlot).toHaveBeenCalledWith(slot);
    expect(api.validator.producePayloadAttestationData).toHaveBeenCalledWith({slot});
    expect(validatorStore.signPayloadAttestation).toHaveBeenCalledWith(
      duty,
      payloadAttestationData,
      clock.getCurrentSlot(),
      loggerVc
    );
    expect(api.beacon.submitPayloadAttestationMessages).toHaveBeenCalledWith({
      payloadAttestationMessages: [payloadAttestationMessage],
    });
  });

  it("Should redownload PTC duties when dependent root changes", async () => {
    const slot = 0;
    const newDependentRoot = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const clock = new ClockMock();
    const config = createChainForkConfig({...defaultConfig, GLOAS_FORK_EPOCH: 0});
    const duty: routes.validator.PtcDuty = {
      slot,
      validatorIndex: 0,
      pubkey: pubkeys[0],
    };
    const reorgedDuty: routes.validator.PtcDuty = {
      ...duty,
      slot: slot + 1,
    };

    api.validator.getPtcDuties.mockResolvedValue(
      mockApiResponse({data: [duty], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    const ptcDutiesService = new PtcDutiesService(
      config,
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeadTracker,
      syncingStatusTracker,
      null
    );

    await clock.tickEpochFns(0, controller.signal);
    expect(ptcDutiesService.getDutiesAtSlot(slot)).toEqual([duty]);

    api.validator.getPtcDuties.mockResolvedValueOnce(
      mockApiResponse({data: [reorgedDuty], meta: {dependentRoot: newDependentRoot, executionOptimistic: false}})
    );

    await ptcDutiesService["onNewHead"]({
      slot,
      head: newDependentRoot,
      previousDutyDependentRoot: newDependentRoot,
      currentDutyDependentRoot: ZERO_HASH_HEX,
    });

    expect(ptcDutiesService.getDutiesAtSlot(slot + 1)).toEqual([reorgedDuty]);
  });
});
