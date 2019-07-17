import {assert} from "chai";
import {ethers} from "ethers";
import sinon from "sinon";
import {Eth1Wallet, EthersEth1Notifier, IEth1Notifier} from "../../../src/eth1";
import defaults from "../../../src/eth1/dev/options";
import {PrivateEth1Network} from "../../../src/eth1/dev";
import {BeaconDB} from "../../../src/db/api";
import {PouchDbController} from "../../../src/db";
import {ILogger, WinstonLogger} from "../../../src/logger";
import {OpPool} from "../../../src/opPool";
import {createIBeaconConfig} from "../../../src/config";
import * as mainetParams from "../../../src/params/presets/mainnet";

describe("Eth1Notifier - using deployed contract", () => {

  let eth1Notifier: IEth1Notifier;
  let eth1Network: PrivateEth1Network;
  let depositContractAddress;
  let provider;
  let logger: ILogger = new WinstonLogger();
  let config = createIBeaconConfig(mainetParams);

  const db = new BeaconDB({
    config,
    controller: new PouchDbController(
      {name: 'testDb'}
    )
  });

  beforeEach(async function () {
    this.timeout(0);
    logger.silent(true);
    // deploy deposit contract
    eth1Network = new PrivateEth1Network({
      host: '127.0.0.1',
      port: 34569
    },
    {
      logger: logger
    });
    await eth1Network.start();
    depositContractAddress = await eth1Network.deployDepositContract();
    provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:34569');
    provider.pollingInterval = 1;
    provider.polling = true;
    const opts = defaults;
    opts.depositContract.address = depositContractAddress;
    opts.providerInstance = provider;
    eth1Notifier = new EthersEth1Notifier(
      opts,
      {
        config,
        opPool: new OpPool(null, {db, chain: null}),
        logger: logger
      });
    await eth1Notifier.start();
  });

  afterEach(async () => {
    await eth1Notifier.stop();
    await eth1Network.stop();
    logger.silent(false);
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

    assert(cb.calledOnce, "deposit event did not fire");
  });

  it("should process a Eth2Genesis log", async function () {
    this.timeout(0);

    const cb = sinon.spy();
    eth1Notifier.on('eth2genesis', cb);
    await Promise.all(
      eth1Network
        .accounts()
        .map((account) =>
          (new Eth1Wallet(account, defaults.depositContract.abi, config, logger, provider))
            .createValidatorDeposit(
              depositContractAddress,
              ethers.utils.parseEther('32.0')
            )
        )
    );
    assert(cb.called, "eth2genesis event did not fire");
  });

});
