import {describe, it, expect, afterEach, vi} from "vitest";
import {Web3} from "web3";
import {ethers} from "ethers";
import {createVerifiedExecutionProvider} from "../../src/web3_provider.js";
import {ELRpc} from "../../src/utils/rpc.js";
import {ProofProvider} from "../../src/proof_provider/proof_provider.js";
import {LCTransport, Web3ProviderType} from "../../src/interfaces.js";
import {JsonRpcRequest, JsonRpcRequestOrBatch, JsonRpcResponse} from "../../src/types.js";

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

    describe("non-mutated provider", () => {
      it("should create an ELRpc object from the web3 provider when non-mutate options provided", () => {
        const {provider, proofProvider} = createVerifiedExecutionProvider(
          new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io"),
          {
            transport: LCTransport.Rest,
            urls: ["https://lodestar-sepolia.chainsafe.io"],
            network: "sepolia",
            mutateProvider: false,
          }
        );

        expect(provider).toBeInstanceOf(ELRpc);
        expect(proofProvider).toBeInstanceOf(ProofProvider);
      });
    });

    describe("custom provider type", () => {
      it.only("should be able to detect and use the custom provider", async () => {
        type CustomProvider = {myrequest: (payload: JsonRpcRequest) => Promise<JsonRpcResponse>};

        const customProviderType: Web3ProviderType<CustomProvider> = {
          matched(provider): provider is CustomProvider {
            return true;
          },

          handler(provider) {
            const handler = provider.myrequest.bind(provider);

            return function newHandler(payload: JsonRpcRequestOrBatch) {
              if (Array.isArray(payload)) {
                return Promise.all(payload.map((p) => handler(p)));
              }

              return handler(payload);
            };
          },
          mutateProvider(_provider): void {
            // That's a deprecated behavior we don't want to test it
          },
        };

        const customProvider = {
          myrequest: vi.fn().mockResolvedValue({result: "my-custom-result"}),
        };

        // Don't invoke network in unit tests
        vi.spyOn(ELRpc.prototype, "verifyCompatibility").mockResolvedValue();
        const {provider} = createVerifiedExecutionProvider(customProvider, {
          transport: LCTransport.Rest,
          urls: ["https://lodestar-sepolia.chainsafe.io"],
          network: "sepolia",
          mutateProvider: false,
          providerTypes: [customProviderType],
        });

        const result = await provider.request("eth_getProof", ["nazar", [], ""]);

        expect(result).toEqual({result: "my-custom-result"});
        expect(customProvider.myrequest).toBeCalledTimes(1);

        expect(customProvider.myrequest).toHaveBeenCalledWith({
          jsonrpc: "2.0",
          id: "1",
          method: "eth_getProof",
          params: ["nazar", [], ""],
        });
      });
    });
  });
});
