import {expect} from "chai";
import Web3 from "web3";
import {ethers} from "ethers";
import {LCTransport} from "../../src/interfaces.js";
import {createVerifiedExecutionProvider} from "../../src/web3_provider.js";

const rpcURL = "http://0.0.0.0:8001";
const beaconUrl = "http://0.0.0.0:5001";

describe("web3_provider", () => {
  describe("createVerifiedExecutionProvider", function () {
    // As the code will try to sync the light client, it may take a while
    this.timeout(10000);

    describe("web3", () => {
      it("should connect to the network and call non-verified method", async () => {
        const {provider} = createVerifiedExecutionProvider(new Web3.providers.HttpProvider(rpcURL), {
          transport: LCTransport.Rest,
          urls: [beaconUrl],
          network: "mainnet",
        });

        const web3 = new Web3(provider);
        const accounts = await web3.eth.getAccounts();
        // `getProof` will always remain the non-verified method
        // as we use it to create proof and verify
        expect(accounts).not.to.be.empty;
        await expect(web3.eth.getProof(accounts[0], [], "latest")).fulfilled;
      });
    });

    describe("ethers", () => {
      it("should connect to the network and call non-verified method", async () => {
        const {provider} = createVerifiedExecutionProvider(new ethers.JsonRpcProvider(rpcURL), {
          transport: LCTransport.Rest,
          urls: [beaconUrl],
          network: "mainnet",
        });
        const accounts = await provider.listAccounts();

        expect(accounts).not.to.be.empty;
        await expect(provider.send("eth_getProof", [accounts[0].address, [], "latest"])).fulfilled;
      });
    });
  });
});
