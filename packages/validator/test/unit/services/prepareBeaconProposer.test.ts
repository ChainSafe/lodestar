import {toBufferBE} from "@vekexasia/bigint-buffer2";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {pollPrepareBeaconProposer} from "../../../src/services/prepareBeaconProposer.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {ClockMock} from "../../utils/clock.js";
import {loggerVc} from "../../utils/logger.js";
import {initValidatorStore} from "../../utils/validatorStore.js";

describe("pollPrepareBeaconProposer", () => {
  const api = getApiClientStub();
  const feeRecipient = "0xcccccccccccccccccccccccccccccccccccccccc";
  const gloasForkEpoch = 10;
  const config = createBeaconConfig(
    createChainForkConfig({
      ...defaultConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: gloasForkEpoch,
    }),
    Buffer.alloc(32, 0)
  );

  let validatorStore: ValidatorStore;
  let controller: AbortController;
  let clock: ClockMock;

  beforeAll(async () => {
    validatorStore = await initValidatorStore([SecretKey.fromBytes(toBufferBE(1n, 32))], api, config);
  });

  beforeEach(() => {
    controller = new AbortController();
    clock = new ClockMock();
    vi.spyOn(validatorStore, "pollValidatorIndices").mockResolvedValue([0]);
    vi.spyOn(validatorStore, "getAllLocalIndices").mockReturnValue([0]);
    vi.spyOn(validatorStore, "getFeeRecipientByIndex").mockReturnValue(feeRecipient);
    api.validator.prepareBeaconProposer.mockResolvedValue(mockApiResponse({}));
    pollPrepareBeaconProposer(config, loggerVc, api, clock, validatorStore, null);
  });

  afterEach(() => {
    controller.abort();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("submits the proposer data of all local validators before gloas", async () => {
    await clock.tickEpochFns(gloasForkEpoch - 1, controller.signal);

    expect(api.validator.prepareBeaconProposer).toHaveBeenCalledExactlyOnceWith({
      proposers: [{validatorIndex: 0, feeRecipient}],
    });
  });

  it("does not submit proposer data from gloas", async () => {
    await clock.tickEpochFns(gloasForkEpoch, controller.signal);

    expect(validatorStore.pollValidatorIndices).not.toHaveBeenCalled();
    expect(api.validator.prepareBeaconProposer).not.toHaveBeenCalled();
  });
});
