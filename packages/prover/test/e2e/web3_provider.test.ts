import {request} from "node:http";
import {expect} from "chai";
import Web3 from "web3";
import {ethers} from "ethers";
import {sleep} from "@lodestar/utils";
import {LCTransport} from "../../src/interfaces.js";
import {createVerifiedExecutionProvider} from "../../src/web3_provider.js";

const rpcURL = "http://0.0.0.0:8001";
const beaconUrl = "http://0.0.0.0:5001";
const capellaForkEpoch = 3;

async function waitForEndpoint(url: string): Promise<void> {
  let pass = false;
  while (pass) {
    pass = await new Promise((resolve) => {
      request(url, (res) => {
        if (res.statusCode === 200) {
          return resolve(true);
        }
        resolve(false);
      });
    });
    if (!pass) await sleep(1000);
  }
}

describe("web3_provider", function () {
  // Wait for at least teh capella fork to be started
  // These values are based on `e2e_test_env.ts`
  this.timeout(capellaForkEpoch * 8 * 4 * 1000);

  before("wait for the capella fork", async () => {
    // Wait for the first epoch of capella to pass so that the light client can sync from a finalized checkpoint
    await waitForEndpoint(`${beaconUrl}/eth/v1/beacon/headers/${(capellaForkEpoch + 1) * 8}`);
  });

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
