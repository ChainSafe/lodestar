import {describe, it, expect} from "vitest";
import {ethers} from "ethers";
import Web3 from "web3";
import {isSendProvider, isWeb3jsProvider, isEthersProvider} from "../../../src/utils/assertion.js";

describe("utils/assertion", () => {
  describe("isSendProvider", () => {
    it("should return true if provider is SendProvider", () => {
      const provider = {
        send: (_payload: any, _cb: () => void) => {
          // Do nothing;
        },
      };
      expect(isSendProvider(provider)).toBe(true);
    });

    it("should return false for ethers provider", () => {
      const provider = new ethers.JsonRpcProvider("https://lodestar-sepoliarpc.chainsafe.io");
      expect(isSendProvider(provider)).toBe(false);
    });

    it("should return false for web3 provider", () => {
      const provider = new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io");
      expect(isSendProvider(provider)).toBe(false);
    });
  });

  describe("isWeb3jsProvider", () => {
    it("should return true if provider is web3.js provider", () => {
      const provider = new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io");
      expect(isWeb3jsProvider(provider)).toBe(true);
    });

    it("should return false if provider is not web3.js provider", () => {
      const provider = new ethers.JsonRpcProvider("https://lodestar-sepoliarpc.chainsafe.io");
      expect(isWeb3jsProvider(provider)).toBe(false);
    });
  });

  describe("isEthersProvider", () => {
    it("should return false if provider is not ethers provider", () => {
      const provider = new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io");
      expect(isEthersProvider(provider)).toBe(false);
    });

    it("should return true if provider is ethers provider", () => {
      const provider = new ethers.JsonRpcProvider("https://lodestar-sepoliarpc.chainsafe.io");
      expect(isEthersProvider(provider)).toBe(true);
    });
  });
});
