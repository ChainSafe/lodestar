import {describe, it, expect, afterEach, vi} from "vitest";
import Web3 from "web3";
import {ethers} from "ethers";
import {createVerifiedExecutionProvider, ProofProvider, LCTransport} from "@lodestar/prover/browser";
import {ELRpc} from "../../src/utils/rpc.js";

describe("web3_provider", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createVerifiedExecutionProvider", () => {
    describe("web3", () => {
      it("should create a verified execution provider for the web3 provider", () => {
        // Don't invoke network in unit tests
        vi.spyOn(ELRpc.prototype, "verifyCompatibility").mockResolvedValue();

        const {provider, proofProvider} = createVerifiedExecutionProvider(
          new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io"),
          {
            transport: LCTransport.Rest,
            urls: ["https://lodestar-sepolia.chainsafe.io"],
            network: "sepolia",
          }
        );

        expect(provider).toBeInstanceOf(Web3.providers.HttpProvider);
        expect(proofProvider).toBeInstanceOf(ProofProvider);
      });
    });

    describe("ethers", () => {
      it("should create a verified execution provider for the ethers provider", () => {
        // Don't invoke network in unit tests
        vi.spyOn(ELRpc.prototype, "verifyCompatibility").mockResolvedValue();

        const {provider, proofProvider} = createVerifiedExecutionProvider(
          new ethers.JsonRpcProvider("https://lodestar-sepoliarpc.chainsafe.io"),
          {
            transport: LCTransport.Rest,
            urls: ["https://lodestar-sepolia.chainsafe.io"],
            network: "sepolia",
          }
        );

        expect(provider).toBeInstanceOf(ethers.JsonRpcProvider);
        expect(proofProvider).toBeInstanceOf(ProofProvider);
      });
    });
  });
});
