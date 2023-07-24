import {expect} from "chai";
import Web3 from "web3";
import {ethers} from "ethers";
import sinon from "sinon";
import {createVerifiedExecutionProvider, ProofProvider, LCTransport} from "@lodestar/prover/browser";
import {ELRpc} from "../../src/utils/rpc.js";

describe("web3_provider", () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  describe("createVerifiedExecutionProvider", () => {
    describe("web3", () => {
      it("should create a verified execution provider for the web3 provider", () => {
        // Don't invoke network in unit tests
        sandbox.stub(ELRpc.prototype, "verifyCompatibility").resolves();

        const {provider, proofProvider} = createVerifiedExecutionProvider(
          new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io"),
          {
            transport: LCTransport.Rest,
            urls: ["https://lodestar-sepolia.chainsafe.io"],
            network: "sepolia",
          }
        );

        expect(provider).be.instanceof(Web3.providers.HttpProvider);
        expect(proofProvider).be.instanceOf(ProofProvider);
      });
    });

    describe("ethers", () => {
      it("should create a verified execution provider for the ethers provider", () => {
        // Don't invoke network in unit tests
        sandbox.stub(ELRpc.prototype, "verifyCompatibility").resolves();

        const {provider, proofProvider} = createVerifiedExecutionProvider(
          new ethers.JsonRpcProvider("https://lodestar-sepoliarpc.chainsafe.io"),
          {
            transport: LCTransport.Rest,
            urls: ["https://lodestar-sepolia.chainsafe.io"],
            network: "sepolia",
          }
        );

        expect(provider).be.instanceof(ethers.JsonRpcProvider);
        expect(proofProvider).be.instanceOf(ProofProvider);
      });
    });
  });
});
