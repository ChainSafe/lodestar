import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {IBeaconStateView, interopSecretKey} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {getApiTestModules} from "../../../../utils/api.js";

describe("api/validator registerValidator", () => {
  beforeEach(() => pubkeyCache.reset());
  afterEach(() => pubkeyCache.reset());

  it("forwards pending registrations only when their candidate is in the head state", async () => {
    const modules = getApiTestModules();
    const api = getValidatorApi(defaultApiOptions, modules);
    const keys = [0, 1, 2].map((index) => interopSecretKey(index).toPublicKey().toBytes());
    pubkeyCache.append(0, keys[0]);
    pubkeyCache.addCandidate(1, keys[1]);
    pubkeyCache.addCandidate(2, keys[2]);
    pubkeyCache.addCandidate(1, keys[2]);
    modules.chain.getHeadState.mockReturnValue({
      validatorCount: 2,
      getValidator: (index: number) => ({
        ...ssz.phase0.Validator.defaultValue(),
        pubkey: keys[index === 0 ? 0 : 2],
        activationEligibilityEpoch: FAR_FUTURE_EPOCH,
        activationEpoch: FAR_FUTURE_EPOCH,
        exitEpoch: FAR_FUTURE_EPOCH,
      }),
    } as IBeaconStateView);
    modules.chain.executionBuilder.registerValidator = vi.fn().mockResolvedValue(undefined);
    const registrations = keys.slice(1).map((pubkey) => {
      const registration = ssz.bellatrix.SignedValidatorRegistrationV1.defaultValue();
      registration.message.pubkey = pubkey;
      return registration;
    });

    await api.registerValidator({registrations});

    expect(modules.chain.executionBuilder.registerValidator).toHaveBeenCalledExactlyOnceWith(
      modules.chain.clock.currentEpoch,
      [registrations[1]]
    );
    expect(pubkeyCache.size).toBe(1);
  });
});
