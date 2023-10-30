/* eslint-disable @typescript-eslint/naming-convention */
import {describe, it, expect, beforeAll} from "vitest";
import Web3 from "web3";
import {ethers} from "ethers";
import {LCTransport} from "../../src/interfaces.js";
import {createVerifiedExecutionProvider} from "../../src/web3_provider.js";
import {waitForCapellaFork, testTimeout, rpcUrl, beaconUrl, config} from "../utils/e2e_env.js";

/* prettier-ignore */
describe("web3_provider", function () {
  beforeAll(async () => {
    await waitForCapellaFork();
  });

  describe("createVerifiedExecutionProvider", () => {
    describe("web3", () => {
      it("should connect to the network and call a non-verified method", async () => {
        const {provider} = createVerifiedExecutionProvider(new Web3.providers.HttpProvider(rpcUrl), {
          transport: LCTransport.Rest,
          urls: [beaconUrl],
          config,
        });

        const web3 = new Web3(provider);
        const accounts = await web3.eth.getAccounts();
        // `getProof` will always remain the non-verified method
        // as we use it to create proof and verify
        expect(Object.keys(accounts)).not.toHaveLength(0);
        await expect(web3.eth.getProof(accounts[0], [], "latest")).resolves.toBeDefined();
      });
    });

    describe("ethers", () => {
      it("should connect to the network and call a non-verified method", async () => {
        const {provider} = createVerifiedExecutionProvider(new ethers.JsonRpcProvider(rpcUrl), {
          transport: LCTransport.Rest,
          urls: [beaconUrl],
          config,
        });
        const accounts = await provider.listAccounts();

        expect(Object.keys(accounts)).not.toHaveLength(0);
        await expect(provider.send("eth_getProof", [accounts[0].address, [], "latest"])).resolves.toBeDefined();
      });
    });
  });
}, {timeout: testTimeout});
