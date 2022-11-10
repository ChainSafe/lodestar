import "mocha";
import {expect} from "chai";
import {getTestnetConfig, medallaTestnetConfig} from "../../utils/testnet.js";
import {getDepositsStream, getDepositsAndBlockStreamForGenesis} from "../../../src/eth1/stream.js";
import {Eth1Provider} from "../../../src/eth1/provider/eth1Provider.js";
import {getGoerliRpcUrl} from "../../testParams.js";
import {Eth1Options} from "../../../src/eth1/options.js";

describe.skip("Eth1 streams", function () {
  this.timeout("2 min");

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  const config = getTestnetConfig();

  // Compute lazily since getGoerliRpcUrl() throws if GOERLI_RPC_URL is not set
  function getEth1Provider(): Eth1Provider {
    const eth1Options: Eth1Options = {
      enabled: true,
      providerUrls: [getGoerliRpcUrl()],
      depositContractDeployBlock: 0,
      unsafeAllowDepositDataOverwrite: false,
    };
    return new Eth1Provider(config, eth1Options, controller.signal);
  }

  const maxBlocksPerPoll = 1000;
  const depositsToFetch = 1000;
  const eth1Params = {...config, maxBlocksPerPoll};

  it(`Should fetch ${depositsToFetch} deposits with getDepositsStream`, async function () {
    const depositsStream = getDepositsStream(
      medallaTestnetConfig.blockWithDepositActivity,
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
      medallaTestnetConfig.blockWithDepositActivity,
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
