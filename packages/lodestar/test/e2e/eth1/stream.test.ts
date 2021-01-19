import "mocha";
import {expect} from "chai";
import {AbortController} from "abort-controller";
import {getPyrmontConfig, pyrmont} from "../../utils/pyrmont";
import {getDepositsStream, getDepositsAndBlockStreamForGenesis, Eth1Provider} from "../../../src/eth1";

describe("Eth1 streams", function () {
  this.timeout("2 min");

  const config = getPyrmontConfig();
  const eth1Provider = new Eth1Provider(config, {
    enabled: true,
    providerUrl: pyrmont.providerUrl,
    depositContractDeployBlock: pyrmont.depositBlock,
  });

  const MAX_BLOCKS_PER_POLL = 1000;
  const depositsToFetch = 1000;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const eth1Params = {...config.params, MAX_BLOCKS_PER_POLL};

  it(`Should fetch ${depositsToFetch} deposits with getDepositsStream`, async function () {
    const controller = new AbortController();
    const depositsStream = getDepositsStream(
      pyrmont.blockWithDepositActivity,
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
      pyrmont.blockWithDepositActivity,
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
