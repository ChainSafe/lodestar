import {expect} from "chai";
import Web3 from "web3";
import {ethers} from "ethers";
import {LCTransport} from "../../src/interfaces.js";
import {createVerifiedExecutionProvider} from "../../src/web3_provider.js";

describe("web3_provider", () => {
  describe("createVerifiedExecutionProvider", function () {
    // As the code will try to sync the light client, it may take a while
    this.timeout(10000);

    describe("web3", () => {
      it("should connect to the network and call non-verified method", async () => {
        const {provider} = createVerifiedExecutionProvider(
          new Web3.providers.HttpProvider("https://lodestar-sepoliarpc.chainsafe.io"),
          {
            transport: LCTransport.Rest,
            urls: ["https://lodestar-sepolia.chainsafe.io"],
            network: "sepolia",
          }
        );

        const web3 = new Web3(provider);
        // `getProof` will always remain the non-verified method
        // as we use it to create proof and verify
        await expect(web3.eth.getProof("0xf97e180c050e5Ab072211Ad2C213Eb5AEE4DF134", [], "latest")).fulfilled;
      });
    });

    describe("ethers", () => {
      it("should connect to the network and call non-verified method", async () => {
        const {provider} = createVerifiedExecutionProvider(
          new ethers.JsonRpcProvider("https://lodestar-sepoliarpc.chainsafe.io"),
          {
            transport: LCTransport.Rest,
            urls: ["https://lodestar-sepolia.chainsafe.io"],
            network: "sepolia",
          }
        );
        await expect(provider.send("eth_getProof", ["0xf97e180c050e5Ab072211Ad2C213Eb5AEE4DF134", [], "latest"]))
          .fulfilled;
      });
    });
  });
});
