import {ethers} from "ethers";
import {describe, expect, it} from "vitest";
import {Web3} from "web3";
import ethersProviderType from "../../../src/provider_types/ethers_provider_type.js";

describe("matched", () => {
  it("should return false if provider is not ethers provider", () => {
    const provider = new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io");
    expect(ethersProviderType.matched(provider)).toBe(false);
  });

  it("should return true if provider is ethers provider", () => {
    const provider = new ethers.JsonRpcProvider("https://lodestar-sepoliarpc.chainsafe.io");
    expect(ethersProviderType.matched(provider)).toBe(true);
  });
});
