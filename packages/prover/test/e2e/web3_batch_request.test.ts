/* eslint-disable @typescript-eslint/naming-convention */
import {expect} from "chai";
import Web3 from "web3";
import {LCTransport} from "../../src/interfaces.js";
import {createVerifiedExecutionProvider} from "../../src/web3_provider.js";
import {rpcURL, beaconUrl, config} from "../utils/e2e_env.js";

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
              web3.eth.getBalance.request(account, "latest", (err, result) => {
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
              web3.eth.getProof.request(account, [], "latest", (err, result) => {
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
          web3.eth.getBalance.request(accounts[0], "latest", (err, result) => {
            if (err) return reject(err);

            resolve(result);
          })
        );
      });

      const invalidHash = "0x9dccb8cd5417e188701e2f36adf8ad17eec7913d34c3517ba74fcfd870bed8e6";
      const errorRequest = new Promise((resolve, reject) => {
        batch.add(
          // @ts-expect-error web3 types are not up to date
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          web3.eth.getBlock.request(invalidHash, (err, result) => {
            if (err) return reject(err);

            resolve(result);
          })
        );
      });

      batch.execute();

      await expect(successRequest).to.be.fulfilled;
      await expect(errorRequest).to.be.rejectedWith("eth_getBlockByHash request can not be verified");
    });
  });
});
