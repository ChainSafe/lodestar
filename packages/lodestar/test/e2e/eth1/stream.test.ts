import "mocha";
import {expect} from "chai";
import {AbortController} from "abort-controller";
import abortable from "abortable-iterator";
import {getMedallaConfig, medalla} from "./util";
import {getDepositsStream, getDepositsAndBlockStreamForGenesis, Eth1Provider} from "../../../src/eth1";

describe("Eth1 streams", function () {
  this.timeout("2 min");

  const config = getMedallaConfig();
  const eth1Provider = new Eth1Provider(config, {
    enabled: true,
    providerUrl: medalla.providerUrl,
    depositContractDeployBlock: medalla.depositBlock,
  });

  const MAX_BLOCKS_PER_POLL = 1000;
  const depositsToFetch = 1000;
  const eth1Params = {...config.params, MAX_BLOCKS_PER_POLL};

  it(`Should fetch ${depositsToFetch} deposits with getDepositsStream`, async function () {
    const controller = new AbortController();
    const depositsStream = getDepositsStream(
      medalla.blockWithDepositActivity,
      eth1Provider,
      eth1Params,
      controller.signal
    );

    let depositCount = 0;
    for await (const {depositEvents} of abortable(depositsStream, controller.signal, {returnOnAbort: true})) {
      depositCount += depositEvents.length;
      if (depositCount > depositsToFetch) {
        controller.abort();
      }
    }

    expect(depositCount).to.be.greaterThan(depositsToFetch, "Not enough deposits were fetched");
  });

  it(`Should fetch ${depositsToFetch} deposits with getDepositsAndBlockStreamForGenesis`, async function () {
    const controller = new AbortController();
    const stream = getDepositsAndBlockStreamForGenesis(
      medalla.blockWithDepositActivity,
      eth1Provider,
      eth1Params,
      controller.signal
    );

    let depositCount = 0;
    for await (const [deposit] of abortable(stream, controller.signal, {returnOnAbort: true})) {
      depositCount += deposit.length;
      if (depositCount > depositsToFetch) {
        controller.abort();
      }
    }

    expect(depositCount).to.be.greaterThan(depositsToFetch, "Not enough deposits were fetched");
  });
});
