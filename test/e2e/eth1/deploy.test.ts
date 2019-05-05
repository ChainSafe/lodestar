import {assert} from "chai";
import {ethers} from "ethers";
import sinon from "sinon";

import {Eth1Wallet, EthersEth1Notifier} from "../../../src/eth1";
import {depositContract} from "../../../src/eth1/dev/defaults";
import {PrivateEth1Network} from "../../../src/eth1/dev";
import logger from "../../../src/logger/winston";
import {PouchDb} from "../../../src/db";

describe("Eth1Notifier - using deployed contract", () => {

  let eth1Notifier;
  let eth1Network;
  let depositContractAddress;
  let provider;
  const db = new PouchDb({name: 'testDb'});

  before(async function() {
    this.timeout(0);
    logger.silent(true);
    // deploy deposit contract
    eth1Network = new PrivateEth1Network({
      host: '127.0.0.1',
      port: 34569
    });
    await eth1Network.start();
    depositContractAddress = await eth1Network.deployDepositContract();
    provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:34569');
    provider.pollingInterval = 1;
    provider.polling = true;
    eth1Notifier = new EthersEth1Notifier({
      depositContract: {
        ...depositContract,
        address: depositContractAddress,
      },
      provider,
    }, {db});
    await eth1Notifier.start();
  });

  after(async() => {
    await eth1Notifier.stop();
    await eth1Network.stop();
    logger.silent(false);
  });

  it("should process a Deposit log", async function() {
    this.timeout(0);
    const wallet = new Eth1Wallet(eth1Network.accounts()[0], provider);

    const cb = sinon.spy();
    eth1Notifier.on('deposit', cb);


    await wallet.createValidatorDeposit(depositContractAddress, ethers.utils.parseEther('32.0'));

    assert(cb.calledOnce, "deposit event did not fire");
  });

  it("should process a Eth2Genesis log", async function() {
    this.timeout(0);

    const cb = sinon.spy();
    eth1Notifier.on('eth2genesis', cb);
    await Promise.all(
      eth1Network
        .accounts()
        .map((account) =>
          (new Eth1Wallet(account, provider))
            .createValidatorDeposit(
              depositContractAddress,
              ethers.utils.parseEther('32.0')
            )
        )
    );
    assert(cb.called, "eth2genesis event did not fire");
  });

});
