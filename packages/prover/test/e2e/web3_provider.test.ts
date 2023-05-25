/* eslint-disable @typescript-eslint/naming-convention */
import {request} from "node:http";
import {expect} from "chai";
import Web3 from "web3";
import {ethers} from "ethers";
import {sleep} from "@lodestar/utils";
import {LCTransport} from "../../src/interfaces.js";
import {createVerifiedExecutionProvider} from "../../src/web3_provider.js";

const rpcURL = "http://0.0.0.0:8001";
const beaconUrl = "http://0.0.0.0:5001";
// Wait for at least teh capella fork to be started
const secondsPerSlot = 4;
const altairForkEpoch = 1;
const bellatrixForkEpoch = 2;
const capellaForkEpoch = 3;
const genesisDelaySeconds = 30 * secondsPerSlot;
const config = {
  ALTAIR_FORK_EPOCH: altairForkEpoch,
  BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
  CAPELLA_FORK_EPOCH: capellaForkEpoch,
  GENESIS_DELAY: genesisDelaySeconds,
};

async function waitForEndpoint(url: string): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await new Promise((resolve) => {
      const req = request(url, {method: "GET"}, (res) => {
        resolve(res.statusCode);
      });
      req.end();
    });
    if (status === 200) {
      break;
    } else {
      await sleep(1000);
    }
  }
}

describe("web3_provider", function () {
  // Wait for at least teh capella fork to be started
  this.timeout((capellaForkEpoch + 2) * 8 * 4 * 1000);

  before("wait for the capella fork", async () => {
    // Wait for the two epoch of capella to pass so that the light client can sync from a finalized checkpoint
    await waitForEndpoint(`${beaconUrl}/eth/v1/beacon/headers/${(capellaForkEpoch + 2) * 8}`);
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
