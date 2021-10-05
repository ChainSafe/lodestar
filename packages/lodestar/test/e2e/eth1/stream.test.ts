import "mocha";
import {expect} from "chai";
import {AbortController} from "@chainsafe/abort-controller";
import {getTestnetConfig, testnet} from "../../utils/testnet";
import {getDepositsStream, getDepositsAndBlockStreamForGenesis} from "../../../src/eth1/stream";
import {Eth1Provider} from "../../../src/eth1/provider/eth1Provider";

describe("Eth1 streams", function () {
  this.timeout("2 min");

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  const config = getTestnetConfig();

  function getEth1Provider(): Eth1Provider {
    return new Eth1Provider(
      config,
      {
        providerUrls: [testnet.providerUrl],
        depositContractDeployBlock: testnet.depositBlock,
      },
      controller.signal
    );
  }

  const maxBlocksPerPoll = 1000;
  const depositsToFetch = 1000;
  const eth1Params = {...config, maxBlocksPerPoll};

  it(`Should fetch ${depositsToFetch} deposits with getDepositsStream`, async function () {
    const depositsStream = getDepositsStream(
      testnet.blockWithDepositActivity,
      getEth1Provider(),
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
    const stream = getDepositsAndBlockStreamForGenesis(
      testnet.blockWithDepositActivity,
      getEth1Provider(),
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
