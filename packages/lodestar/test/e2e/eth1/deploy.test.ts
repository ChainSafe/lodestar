import {assert} from "chai";
import {ethers} from "ethers";
import sinon from "sinon";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {Eth1Wallet, EthersEth1Notifier, IEth1Notifier} from "../../../src/eth1";
import defaults from "../../../src/eth1/dev/options";
import {PrivateEth1Network} from "../../../src/eth1/dev";
import {ILogger, WinstonLogger} from "../../../src/logger";
import {sleep} from "../../utils/sleep";

describe("Eth1Notifier - using deployed contract", () => {

  let eth1Notifier: IEth1Notifier;
  let eth1Network: PrivateEth1Network;
  let depositContractAddress;
  let provider;
  let logger: ILogger = new WinstonLogger();

  beforeEach(async function () {
    this.timeout(0);
    logger.silent = true;
    // deploy deposit contract
    eth1Network = new PrivateEth1Network({
      host: '127.0.0.1',
      port: 34569
    },
    {
      logger,
    });
    depositContractAddress = await eth1Network.start();
    await sleep(300);
    provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:34569', 999);
    provider.pollingInterval = 1;
    provider.polling = true;
    const opts = defaults;
    opts.depositContract.address = depositContractAddress;
    opts.providerInstance = provider;
    eth1Notifier = new EthersEth1Notifier(
      opts,
      {
        config,
        logger: logger
      });
    await eth1Notifier.start();
  });

  afterEach(async () => {
    await eth1Notifier.stop();
    await eth1Network.stop();
    logger.silent = false;
  });

  it("should process a Deposit log", async function () {
    this.timeout(0);
    const wallet = new Eth1Wallet(
      eth1Network.accounts()[0],
      defaults.depositContract.abi,
      config,
      logger,
      provider
    );

    const cb = sinon.spy();
    eth1Notifier.on('deposit', cb);


    await wallet.createValidatorDeposit(depositContractAddress, ethers.utils.parseEther('32.0'));
    await sleep(300);
    assert(cb.calledOnce, "deposit event did not fire");
  });

});
