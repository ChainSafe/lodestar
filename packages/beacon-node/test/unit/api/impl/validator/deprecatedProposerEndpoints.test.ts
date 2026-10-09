import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";

describe("api/validator - proposer data endpoints deprecated from gloas", () => {
  const config = createBeaconConfig(
    createChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 1,
    }),
    Buffer.alloc(32, 0)
  );
  const proposers = [{validatorIndex: 0, feeRecipient: "0xcccccccccccccccccccccccccccccccccccccccc"}];
  const registrations = [ssz.bellatrix.SignedValidatorRegistrationV1.defaultValue()];

  let modules: ApiTestModules;
  let api: ReturnType<typeof getValidatorApi>;

  beforeEach(() => {
    modules = getApiTestModules({config});
    api = getValidatorApi(defaultApiOptions, {...modules, config});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts proposer data before gloas", async () => {
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(SLOTS_PER_EPOCH - 1);

    await api.prepareBeaconProposer({proposers});

    expect(modules.chain.updateBeaconProposerData).toHaveBeenCalledOnce();
    expect(modules.logger.warn).not.toHaveBeenCalled();
  });

  it("rejects proposer data from gloas", async () => {
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(SLOTS_PER_EPOCH);

    await expect(api.prepareBeaconProposer({proposers})).rejects.toMatchObject({statusCode: 410});

    expect(modules.chain.updateBeaconProposerData).not.toHaveBeenCalled();
    expect(modules.logger.warn).toHaveBeenCalledOnce();
  });

  it("rejects validator registrations from gloas", async () => {
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(SLOTS_PER_EPOCH);

    await expect(api.registerValidator({registrations})).rejects.toMatchObject({statusCode: 410});

    expect(modules.logger.warn).toHaveBeenCalledOnce();
  });
});
