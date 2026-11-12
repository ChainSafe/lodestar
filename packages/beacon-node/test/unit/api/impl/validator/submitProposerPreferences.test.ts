import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {
  GossipAction,
  ProposerPreferencesError,
  ProposerPreferencesErrorCode,
} from "../../../../../src/chain/errors/index.js";
import {validateGossipProposerPreferences} from "../../../../../src/chain/validation/proposerPreferences.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";

vi.mock("../../../../../src/chain/validation/proposerPreferences.js", async (importActual) => ({
  ...(await importActual<object>()),
  validateGossipProposerPreferences: vi.fn().mockResolvedValue(undefined),
}));

describe("api/validator - submitProposerPreferences", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getValidatorApi>;

  function signedPreferences(validatorIndex: number) {
    const signed = ssz.gloas.SignedProposerPreferences.defaultValue();
    signed.message.validatorIndex = validatorIndex;
    signed.message.proposalSlot = 160 + validatorIndex;
    return signed;
  }

  beforeEach(() => {
    modules = getApiTestModules();
    api = getValidatorApi(defaultApiOptions, modules);
    vi.spyOn(modules.chain.clock, "currentEpoch", "get").mockReturnValue(5);
    modules.network.publishProposerPreferences = vi.fn().mockResolvedValue(1);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("tracks the validators of accepted and already known preferences as attached", async () => {
    vi.mocked(validateGossipProposerPreferences)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new ProposerPreferencesError(GossipAction.IGNORE, {
          code: ProposerPreferencesErrorCode.ALREADY_KNOWN,
          proposalSlot: 161,
          validatorIndex: 1,
          dependentRoot: "0x",
        })
      )
      .mockRejectedValueOnce(
        new ProposerPreferencesError(GossipAction.REJECT, {
          code: ProposerPreferencesErrorCode.INVALID_SIGNATURE,
          proposalSlot: 162,
          validatorIndex: 2,
        })
      );

    await expect(
      api.submitProposerPreferences({
        signedProposerPreferences: [signedPreferences(0), signedPreferences(1), signedPreferences(2)],
      })
    ).rejects.toThrow("Error processing signed proposer preferences");

    expect(modules.chain.updateAttachedValidators).toHaveBeenCalledOnce();
    const [epoch, indices] = modules.chain.updateAttachedValidators.mock.calls[0];
    expect(epoch).toBe(5);
    expect([...indices].sort()).toEqual([0, 1]);
    expect(modules.network.publishProposerPreferences).toHaveBeenCalledOnce();
  });

  it("does not track anything if every preference is rejected", async () => {
    vi.mocked(validateGossipProposerPreferences).mockRejectedValueOnce(
      new ProposerPreferencesError(GossipAction.REJECT, {
        code: ProposerPreferencesErrorCode.INVALID_SIGNATURE,
        proposalSlot: 160,
        validatorIndex: 0,
      })
    );

    await expect(api.submitProposerPreferences({signedProposerPreferences: [signedPreferences(0)]})).rejects.toThrow();

    expect(modules.chain.updateAttachedValidators).not.toHaveBeenCalled();
  });
});
