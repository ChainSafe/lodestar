import {toBufferBE} from "@vekexasia/bigint-buffer2";
import {Mocked, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {InclusionListDutiesService} from "../../../src/services/inclusionListDuties.js";
import {SyncingStatusTracker} from "../../../src/services/syncingStatusTracker.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {ClockMock} from "../../utils/clock.js";
import {loggerVc} from "../../utils/logger.js";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../utils/types.js";
import {initValidatorStore} from "../../utils/validatorStore.js";

vi.mock("../../../src/services/chainHeaderTracker.js");

describe("InclusionListDutiesService", () => {
  const api = getApiClientStub();
  const config = createChainForkConfig({...chainConfig, HEZE_FORK_EPOCH: 0});

  let validatorStore: ValidatorStore;

  // @ts-expect-error - Mocked class don't need parameters
  const chainHeadTracker = new ChainHeaderTracker() as Mocked<ChainHeaderTracker>;

  beforeAll(async () => {
    const secretKeys = [SecretKey.fromBytes(toBufferBE(BigInt(98), 32))];
    validatorStore = await initValidatorStore(secretKeys, api, chainConfig);
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => {
    controller = new AbortController();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    controller.abort();
  });

  it.each([1, 2])(
    "Should merge duties for a newly discovered validator with %i cached duties",
    async (existingCount) => {
      const slot = 1;
      const epoch = computeEpochAtSlot(slot);
      const duties: routes.validator.InclusionListDuty[] = Array.from(
        {length: existingCount + 1},
        (_, validatorIndex) => ({
          slot,
          validatorIndex,
          dependentRoot: ZERO_HASH,
          pubkey: SecretKey.fromBytes(toBufferBE(BigInt(validatorIndex + 1), 32))
            .toPublicKey()
            .toBytes(),
        })
      );

      api.validator.getInclusionListCommitteeDuties.mockImplementation(async ({indices}) =>
        mockApiResponse({
          data: duties.filter((duty) => indices.includes(duty.validatorIndex)),
          meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false},
        })
      );

      const existingIndices = duties.slice(0, existingCount).map((duty) => duty.validatorIndex);
      vi.spyOn(validatorStore, "getAllLocalIndices").mockReturnValue(existingIndices);
      const pollValidatorIndices = vi.spyOn(validatorStore, "pollValidatorIndices").mockResolvedValue([]);
      vi.spyOn(validatorStore, "hasVotingPubkey").mockReturnValue(true);
      vi.spyOn(validatorStore, "isDoppelgangerSafe").mockReturnValue(true);

      const clock = new ClockMock();
      const syncingStatusTracker = new SyncingStatusTracker(loggerVc, api, clock, null);
      const dutiesService = new InclusionListDutiesService(
        config,
        loggerVc,
        api,
        clock,
        validatorStore,
        chainHeadTracker,
        syncingStatusTracker
      );

      await clock.tickEpochFns(epoch, controller.signal);
      expect(dutiesService.getDutiesAtSlot(slot)).toEqual(duties.slice(0, existingCount));

      pollValidatorIndices.mockResolvedValueOnce([existingCount]);
      await clock.tickEpochFns(epoch, controller.signal);

      expect(api.validator.getInclusionListCommitteeDuties).toHaveBeenCalledWith({epoch, indices: [existingCount]});
      expect(dutiesService.getDutiesAtSlot(slot)).toEqual(duties);
    }
  );
});
