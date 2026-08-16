import {beforeEach, describe, expect, it} from "vitest";
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
    api = getValidatorApi(defaultApiOptions, modules);
  });

  it("reports an invalid url by index while submitting the other entries", async () => {
    const invalidUrl = "not a url";
    const validEntry = getEntry("https://builder.example.com");
    const invalidEntry = getEntry(invalidUrl);

    let error: unknown;
    try {
      await api.submitBuilderPreferences({builderPreferences: [invalidEntry, validEntry]});
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(IndexedError);
    expect((error as IndexedError).failures).toEqual([{index: 0, message: "Invalid URL"}]);
    expect(modules.chain.builderApiClient.submitBuilderPreferences).toHaveBeenCalledOnce();
    expect(modules.chain.builderApiClient.submitBuilderPreferences).toHaveBeenCalledWith(
      "https://builder.example.com",
      validEntry.proposerPubkey,
      {preferences: {maxExecutionPayment: 0n}, auth: validEntry.auth}
    );
    expect(modules.logger.verbose).toHaveBeenCalledWith(
      "Error on submitBuilderPreferences [0]",
      {slot: 1, builder: invalidUrl},
      expect.any(Error)
    );
  });
});

function getEntry(url: string) {
  const auth = ssz.gloas.SignedRequestAuth.defaultValue();
  auth.message.slot = 1;
  return {
    proposerPubkey: new Uint8Array(48),
    url: new TextEncoder().encode(url),
    auth,
    maxExecutionPayment: 0n,
  };
}
