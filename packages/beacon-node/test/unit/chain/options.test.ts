import {describe, expect, it} from "vitest";
import {defaultChainOptions} from "../../../src/chain/options.js";

describe("defaultChainOptions", () => {
  it("should disable all adversarial behaviors", () => {
    expect(defaultChainOptions.adversarialReorgBuildOnEmpty).toBe(false);
    expect(defaultChainOptions.adversarialReorgOmitPtcAttestations).toBe(false);
  });
});
