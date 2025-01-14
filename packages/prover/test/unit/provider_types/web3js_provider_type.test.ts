import {ethers} from "ethers";
import {describe, expect, it} from "vitest";
import {Web3} from "web3";
import web3jsProviderType from "../../../src/provider_types/web3_js_provider_type.js";

describe("matched", () => {
  it("should return true if provider is web3.js provider", () => {
    const provider = new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io");
    expect(web3jsProviderType.matched(provider)).toBe(true);
  });

  it("should return false if provider is not web3.js provider", () => {
    const provider = new ethers.JsonRpcProvider("https://lodestar-sepoliarpc.chainsafe.io");
    expect(web3jsProviderType.matched(provider)).toBe(false);
  });
});
