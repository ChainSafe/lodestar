import "mocha";
import {expect} from "chai";
import {AbortController} from "abort-controller";
import {getTestnetConfig, testnet} from "../../utils/testnet";
import {getDepositsStream, getDepositsAndBlockStreamForGenesis, Eth1Provider} from "../../../src/eth1";

describe("Eth1 streams", function () {
  this.timeout("2 min");

  const config = getTestnetConfig();
  const eth1Provider = new Eth1Provider(config, {
    enabled: true,
    providerUrl: testnet.providerUrl,
    depositContractDeployBlock: testnet.depositBlock,
  });

  const maxBlocksPerPoll = 1000;
  const depositsToFetch = 1000;
  const eth1Params = {...config.params, maxBlocksPerPoll};

  it(`Should fetch ${depositsToFetch} deposits with getDepositsStream`, async function () {
    const controller = new AbortController();
    const depositsStream = getDepositsStream(
      testnet.blockWithDepositActivity,
      eth1Provider,
      eth1Params,
      controller.signal
    );

    let depositCount = 0;
    for await (const {depositEvents} of depositsStream) {
      depositCount += depositEvents.length;
      if (depositCount > depositsToFetch) {
        break;
      }
    }

    expect(depositCount).to.be.greaterThan(depositsToFetch, "Not enough deposits were fetched");
  });

  it(`Should fetch ${depositsToFetch} deposits with getDepositsAndBlockStreamForGenesis`, async function () {
    const controller = new AbortController();
    const stream = getDepositsAndBlockStreamForGenesis(
      testnet.blockWithDepositActivity,
      eth1Provider,
      eth1Params,
      controller.signal
    );

    let depositCount = 0;
    for await (const [deposit] of stream) {
      depositCount += deposit.length;
      if (depositCount > depositsToFetch) {
        break;
      }
    }

    expect(depositCount).to.be.greaterThan(depositsToFetch, "Not enough deposits were fetched");
  });
});
