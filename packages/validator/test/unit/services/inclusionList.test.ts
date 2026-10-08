import {toBufferBE} from "@vekexasia/bigint-buffer2";
import {Mocked, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {ValidatorEvent, ValidatorEventEmitter} from "../../../src/services/emitter.js";
import {InclusionListService} from "../../../src/services/inclusionList.js";
import {SyncingStatusTracker} from "../../../src/services/syncingStatusTracker.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {ClockMock} from "../../utils/clock.js";
import {loggerVc} from "../../utils/logger.js";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../utils/types.js";
import {initValidatorStore} from "../../utils/validatorStore.js";

vi.mock("../../../src/services/chainHeaderTracker.js");

describe("InclusionListService", () => {
  const api = getApiClientStub();
  const slot = 1;
  const validatorIndex = 4;

  let validatorStore: ValidatorStore;
  let pubkey: Uint8Array;

  // @ts-expect-error - Mocked class don't need parameters
  const chainHeadTracker = new ChainHeaderTracker() as Mocked<ChainHeaderTracker>;

  beforeAll(async () => {
    const secretKeys = [SecretKey.fromBytes(toBufferBE(BigInt(98), 32))];
    pubkey = secretKeys[0].toPublicKey().toBytes();
    validatorStore = await initValidatorStore(secretKeys, api, chainConfig);
  });

  let controller: AbortController;
  beforeEach(() => {
    controller = new AbortController();
    api.validator.getInclusionListCommitteeDuties.mockResolvedValue(
      mockApiResponse({
        data: [{pubkey, validatorIndex, slot, dependentRoot: ZERO_HASH}],
        meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false},
      })
    );
    api.validator.produceInclusionList.mockResolvedValue(mockApiResponse({data: [], meta: {version: ForkName.heze}}));
    vi.spyOn(validatorStore, "getAllLocalIndices").mockReturnValue([validatorIndex]);
    vi.spyOn(validatorStore, "pollValidatorIndices").mockResolvedValue([]);
    vi.spyOn(validatorStore, "hasVotingPubkey").mockReturnValue(true);
    vi.spyOn(validatorStore, "isDoppelgangerSafe").mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    controller.abort();
  });

  // Returns the running slot task wrapped in an object so the async function does not await it
  async function startSlotTask(
    config: ChainForkConfig,
    emitter: ValidatorEventEmitter
  ): Promise<{task: Promise<void>}> {
    const clock = new ClockMock();
    const syncingStatusTracker = new SyncingStatusTracker(loggerVc, api, clock, null);
    new InclusionListService(
      config,
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeadTracker,
      syncingStatusTracker,
      emitter
    );
    await clock.tickEpochFns(0, controller.signal);
    return {task: clock.tickSlotFns(slot, controller.signal)};
  }

  it("removes the payload listener once the slot's payload is available", async () => {
    const config = createChainForkConfig({...chainConfig, HEZE_FORK_EPOCH: 0});
    const emitter = new ValidatorEventEmitter();

    const {task} = await startSlotTask(config, emitter);
    // The duties service's own slot hook runs first, so the listener is registered a few microtasks later
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(emitter.listenerCount(ValidatorEvent.executionPayloadAvailable)).toBe(1);

    emitter.emit(ValidatorEvent.executionPayloadAvailable, {slot, blockRoot: ZERO_HASH_HEX});
    await task;

    expect(api.validator.produceInclusionList).toHaveBeenCalledWith({slot});
    expect(emitter.listenerCount(ValidatorEvent.executionPayloadAvailable)).toBe(0);
  });

  it("removes the payload listener when the deadline wins", async () => {
    const config = createChainForkConfig({...chainConfig, HEZE_FORK_EPOCH: 0, INCLUSION_LIST_DUE_BPS: 0});
    const emitter = new ValidatorEventEmitter();

    const {task} = await startSlotTask(config, emitter);
    await task;

    expect(api.validator.produceInclusionList).toHaveBeenCalledWith({slot});
    expect(emitter.listenerCount(ValidatorEvent.executionPayloadAvailable)).toBe(0);
  });
});
