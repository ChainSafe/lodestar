/* eslint-disable @typescript-eslint/naming-convention */
import {expect} from "chai";
import Web3 from "web3";
import {ethers} from "ethers";
import {LCTransport} from "../../src/interfaces.js";
import {createVerifiedExecutionProvider} from "../../src/web3_provider.js";
import {waitForCapellaFork, testTimeout, rpcURL, beaconUrl, config} from "../utils/e2e_env.js";

describe("web3_provider", function () {
  this.timeout(testTimeout);

  before("wait for the capella fork", async () => {
    await waitForCapellaFork();
  });

  describe("createVerifiedExecutionProvider", () => {
    describe("web3", () => {
      it("should connect to the network and call a non-verified method", async () => {
        const {provider} = createVerifiedExecutionProvider(new Web3.providers.HttpProvider(rpcURL), {
          transport: LCTransport.Rest,
          urls: [beaconUrl],
          config,
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
      it("should connect to the network and call a non-verified method", async () => {
        const {provider} = createVerifiedExecutionProvider(new ethers.JsonRpcProvider(rpcURL), {
          transport: LCTransport.Rest,
          urls: [beaconUrl],
          config,
        });
        const accounts = await provider.listAccounts();

        expect(accounts).not.to.be.empty;
        await expect(provider.send("eth_getProof", [accounts[0].address, [], "latest"])).fulfilled;
      });
    });
  });
});
