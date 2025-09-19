import {ethers} from "ethers";
import {describe, expect, it} from "vitest";
import {Web3} from "web3";
import legacyProviderType from "../../../src/provider_types/legacy_provider_type.js";

describe("send provider", () => {
  describe("matched", () => {
    it("should return true if provider is SendProvider", () => {
      const provider = {
        send: (_payload: any, _cb: () => void) => {
          // Do nothing;
        },
      };
      expect(legacyProviderType.matched(provider)).toBe(true);
    });

    it("should return false for ethers provider", () => {
      const provider = new ethers.JsonRpcProvider("https://lodestar-sepoliarpc.chainsafe.io");
      expect(legacyProviderType.matched(provider)).toBe(false);
    });

    it("should return false for web3 provider", () => {
      const provider = new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io");
      expect(legacyProviderType.matched(provider)).toBe(false);
    });
  });
});
