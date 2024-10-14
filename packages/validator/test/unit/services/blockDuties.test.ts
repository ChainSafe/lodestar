import {describe, it, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
import {toBufferBE} from "bigint-buffer";
import {toHexString} from "@chainsafe/ssz";
import {SecretKey} from "@chainsafe/blst";
import {routes} from "@lodestar/api";
import {chainConfig} from "@lodestar/config/default";
import {toHex} from "@lodestar/utils";
import {BlockDutiesService} from "../../../src/services/blockDuties.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";
import {initValidatorStore} from "../../utils/validatorStore.js";
import {ZERO_HASH_HEX} from "../../utils/types.js";

describe("BlockDutiesService", () => {
  const api = getApiClientStub();
  let validatorStore: ValidatorStore;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  beforeAll(async () => {
    const secretKeys = Array.from({length: 3}, (_, i) => SecretKey.fromBytes(toBufferBE(BigInt(i + 1), 32)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore = await initValidatorStore(secretKeys, api);
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => {
    controller = new AbortController();
  });
  afterEach(() => controller.abort());

  it("Should fetch and persist block duties", async () => {
    // Reply with some duties
    const slot = 0; // genesisTime is right now, so test with slot = currentSlot
    const duties: routes.validator.ProposerDutyList = [{slot: slot, validatorIndex: 0, pubkey: pubkeys[0]}];

    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({data: duties, meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    const notifyBlockProductionFn = vi.fn(); // Returns void

    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(
      chainConfig,
      loggerVc,
      api,
      clock,
      validatorStore,
      null,
      notifyBlockProductionFn
    );

    // Trigger clock onSlot for slot 0
    await clock.tickSlotFns(0, controller.signal);

    // Duties for this epoch should be persisted
    expect(Object.fromEntries(dutiesService["proposers"])).toEqual({0: {dependentRoot: ZERO_HASH_HEX, data: duties}});

    expect(dutiesService.getblockProposersAtSlot(slot)).toEqual([pubkeys[0]]);

    expect(notifyBlockProductionFn).toHaveBeenCalledOnce();
  });

  it("Should call notifyBlockProductionFn again on duties re-org", async () => {
    // A re-org will happen at slot 1
    const dependentRootDiff = toHex(Buffer.alloc(32, 1));
    const dutiesBeforeReorg: routes.validator.ProposerDutyList = [{slot: 1, validatorIndex: 0, pubkey: pubkeys[0]}];
    const dutiesAfterReorg: routes.validator.ProposerDutyList = [{slot: 1, validatorIndex: 1, pubkey: pubkeys[1]}];

    const notifyBlockProductionFn = vi.fn(); // Returns void

    // Clock will call runAttesterDutiesTasks() immediately
    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(
      chainConfig,
      loggerVc,
      api,
      clock,
      validatorStore,
      null,
      notifyBlockProductionFn
    );

    // Trigger clock onSlot for slot 0
    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({data: dutiesBeforeReorg, meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );
    await clock.tickSlotFns(0, controller.signal);

    // Trigger clock onSlot for slot 1 - Return different duties for slot 1
    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({data: dutiesAfterReorg, meta: {dependentRoot: dependentRootDiff, executionOptimistic: false}})
    );
    await clock.tickSlotFns(1, controller.signal);

    // Should persist the dutiesAfterReorg
    expect(Object.fromEntries(dutiesService["proposers"])).toEqual({
      0: {dependentRoot: dependentRootDiff, data: dutiesAfterReorg},
    });

    expect(notifyBlockProductionFn).toBeCalledTimes(2);

    expect(notifyBlockProductionFn.mock.calls[0]).toEqual([1, [pubkeys[0]]]);
    expect(notifyBlockProductionFn.mock.calls[1]).toEqual([1, [pubkeys[1]]]);
  });

  it("Should remove signer from duty", async () => {
    // Reply with some duties
    const slot = 0; // genesisTime is right now, so test with slot = currentSlot
    const duties: routes.validator.ProposerDutyList = [
      {slot: slot, validatorIndex: 0, pubkey: pubkeys[0]},
      {slot: slot, validatorIndex: 1, pubkey: pubkeys[1]},
      {slot: 33, validatorIndex: 2, pubkey: pubkeys[2]},
    ];
    const dutiesRemoved: routes.validator.ProposerDutyList = [
      {slot: slot, validatorIndex: 1, pubkey: pubkeys[1]},
      {slot: 33, validatorIndex: 2, pubkey: pubkeys[2]},
    ];

    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({data: duties, meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    const notifyBlockProductionFn = vi.fn(); // Returns void

    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(
      chainConfig,
      loggerVc,
      api,
      clock,
      validatorStore,
      null,
      notifyBlockProductionFn
    );

    // Trigger clock onSlot for slot 0
    await clock.tickSlotFns(0, controller.signal);
    await clock.tickSlotFns(32, controller.signal);

    // first confirm the duties for the epochs was persisted
    expect(Object.fromEntries(dutiesService["proposers"])).toEqual({
      0: {dependentRoot: ZERO_HASH_HEX, data: duties},
      1: {dependentRoot: ZERO_HASH_HEX, data: duties},
    });

    // then remove a signers public key
    dutiesService.removeDutiesForKey(toHexString(pubkeys[0]));

    // confirm that the duties no longer contain the signers public key
    expect(Object.fromEntries(dutiesService["proposers"])).toEqual({
      0: {dependentRoot: ZERO_HASH_HEX, data: dutiesRemoved},
      1: {dependentRoot: ZERO_HASH_HEX, data: dutiesRemoved},
    });
  });
});
