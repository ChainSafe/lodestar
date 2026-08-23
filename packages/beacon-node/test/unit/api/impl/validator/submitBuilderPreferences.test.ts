import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {IndexedError} from "../../../../../src/api/impl/errors.js";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";

describe("api/validator - submitBuilderPreferences", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getValidatorApi>;

  beforeEach(() => {
    modules = getApiTestModules();
    modules.chain.getHeadState.mockReturnValue({getBeaconProposer: () => 1} as never);
    vi.spyOn(modules.chain.pubkeyCache, "getOrThrow").mockReturnValue({toBytes: () => new Uint8Array(48)} as never);
    api = getValidatorApi(defaultApiOptions, modules);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports an invalid UTF-8 url by index while submitting the other entries", async () => {
    const validEntry = getEntry("https://builder.example.com");
    const invalidEntry = getEntry("https://invalid.example.com");
    invalidEntry.url = new Uint8Array([0xff]);

    let error: unknown;
    try {
      await api.submitBuilderPreferences({builderPreferences: [invalidEntry, validEntry]});
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(IndexedError);
    expect((error as IndexedError).failures).toEqual([{index: 0, message: "Builder url must be valid UTF-8"}]);
    expect(modules.chain.builderApiClient.submitBuilderPreferences).toHaveBeenCalledOnce();
    expect(modules.chain.builderApiClient.submitBuilderPreferences).toHaveBeenCalledWith(
      "https://builder.example.com",
      validEntry.proposerPubkey,
      {preferences: {maxExecutionPayment: 0n}, auth: validEntry.auth}
    );
    expect(modules.logger.verbose).toHaveBeenCalledWith(
      "Error on submitBuilderPreferences [0]",
      {slot: 1, builder: "�"},
      expect.any(Error)
    );
  });

  it("rejects preferences not signed by the slot proposer", async () => {
    const entry = getEntry("https://builder.example.com");
    entry.proposerPubkey[0] = 1;

    let error: unknown;
    try {
      await api.submitBuilderPreferences({builderPreferences: [entry]});
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(IndexedError);
    expect((error as IndexedError).failures).toEqual([
      {index: 0, message: "Invalid proposer pubkey for builder preferences slot=1"},
    ]);
    expect(modules.chain.builderApiClient.submitBuilderPreferences).not.toHaveBeenCalled();
  });
});

function getEntry(url: string) {
  const auth = ssz.gloas.SignedBuilderRequestAuth.defaultValue();
  auth.message.slot = 1;
  return {
    proposerPubkey: new Uint8Array(48),
    url: new TextEncoder().encode(url),
    auth,
    maxExecutionPayment: 0n,
  };
}
