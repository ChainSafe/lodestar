/* eslint-disable @typescript-eslint/naming-convention */
import {expect} from "chai";
import Web3 from "web3";
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
  SECONDS_PER_SLOT: secondsPerSlot,
};

describe("web3_batch_requests", function () {
  // Give some margin to sync light client
  this.timeout("10s");

  let web3: Web3;

  before(() => {
    const {provider} = createVerifiedExecutionProvider(new Web3.providers.HttpProvider(rpcURL), {
      transport: LCTransport.Rest,
      urls: [beaconUrl],
      config,
    });

    web3 = new Web3(provider);
  });

  describe("web3", () => {
    it("should be able to process batch request", async () => {
      const accounts = await web3.eth.getAccounts();
      const batch = new web3.eth.BatchRequest();
      const results = [];

      for (const account of accounts) {
        results.push(
          new Promise((resolve, reject) => {
            batch.add(
              // @ts-expect-error web3 types are not up to date
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call
              web3.eth.getBalance.request(account, "latest", (result, err) => {
                if (err) return reject(err);

                resolve(result);
              })
            );
          })
        );
        results.push(
          new Promise((resolve, reject) => {
            batch.add(
              // @ts-expect-error web3 types are not up to date
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call
              web3.eth.getProof.request(account, [], "latest", (result, err) => {
                if (err) return reject(err);

                resolve(result);
              })
            );
          })
        );
      }

      batch.execute();

      expect(results.length).to.be.gt(1);
      await expect(Promise.all(results)).to.be.fulfilled;
    });

    it("should be able to process batch request containing error", async () => {
      const accounts = await web3.eth.getAccounts();
      const batch = new web3.eth.BatchRequest();

      const successRequest = new Promise((resolve, reject) => {
        batch.add(
          // @ts-expect-error web3 types are not up to date
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          web3.eth.getBalance.request(accounts[0], "latest", (result, err) => {
            if (err) return reject(err);

            resolve(result);
          })
        );
      });
      const invalidAddress = accounts[0].slice(0, -1);
      const errorRequest = new Promise((resolve, reject) => {
        batch.add(
          // @ts-expect-error web3 types are not up to date
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          web3.eth.getBalance.request(invalidAddress, "latest", (result, err) => {
            if (err) return reject(err);

            resolve(result);
          })
        );
      });

      batch.execute();

      await expect(successRequest).to.be.fulfilled;
      await expect(errorRequest).to.be.rejectedWith(`Provided address ${invalidAddress} is invalid`);
    });
  });
});
