import "mocha";
import {expect} from "chai";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {params} from "@chainsafe/lodestar-params/lib/presets/mainnet";
import {AbortController} from "abort-controller";
import abortable from "abortable-iterator";
import {getDepositsStream, getDepositsAndBlockStreamForGenesis, Eth1Provider} from "../../../src/eth1";

describe("Eth1 streams", function () {
  this.timeout("2 min");

  // Medalla optimized blocks for quick testing
  const depositDeploy = 3085928;
  const blockWithDepositActivity = 3124889;

  // Medalla specs
  const config = createIBeaconConfig(params);
  config.params.DEPOSIT_NETWORK_ID = 5;
  config.params.DEPOSIT_CONTRACT_ADDRESS = Buffer.from("07b39F4fDE4A38bACe212b546dAc87C58DfE3fDC", "hex");
  config.params.MIN_GENESIS_TIME = 1596546000;
  config.params.GENESIS_DELAY = 172800;
  const eth1Provider = new Eth1Provider(config, {
    enabled: true,
    providerUrl: "https://goerli.infura.io/v3/bb15bacfcdbe45819caede241dcf8b0d",
    depositContractDeployBlock: depositDeploy,
  });

  const MAX_BLOCKS_PER_POLL = 1000;
  const depositsToFetch = 1000;

  it(`Should fetch ${depositsToFetch} deposits with getDepositsStream`, async function () {
    const depositsStream = getDepositsStream(blockWithDepositActivity, eth1Provider, {
      ...config.params,
      MAX_BLOCKS_PER_POLL,
    });

    const controller = new AbortController();

    let depositCount = 0;
    for await (const {depositEvents} of abortable(depositsStream, controller.signal, {returnOnAbort: true})) {
      depositCount += depositEvents.length;
      if (depositCount > depositsToFetch) {
        console.log({depositCount});
        controller.abort();
      }
    }

    expect(depositCount).to.be.greaterThan(depositsToFetch, "Not enough deposits were fetched");
  });

  it(`Should fetch ${depositsToFetch} deposits with getDepositsAndBlockStreamForGenesis`, async function () {
    const stream = getDepositsAndBlockStreamForGenesis(depositsToFetch, eth1Provider, {
      ...config.params,
      MAX_BLOCKS_PER_POLL,
    });

    const controller = new AbortController();

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
