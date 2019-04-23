import {PrivateEth1Network} from "../../../../src/eth1/dev";
import chai, {expect} from 'chai';
import {DepositCommand} from "../../../../src/cli/commands";
import chaiAsPromised from 'chai-as-promised';
import logger from "../../../../src/logger/winston";

chai.use(chaiAsPromised);

describe('[CLI] deposit', function() {

  let eth1Network: PrivateEth1Network;

  before(async () => {
    logger.silent(true);
    eth1Network = new PrivateEth1Network({
      host: '127.0.0.1',
      port: 32567
    });
    await eth1Network.start();
  });

  after(async () => {
    await eth1Network.stop();
    logger.silent(false);
  });

  it('Should make a deposit for single private key', async () => {
    const contractAddress = await eth1Network.deployDepositContract();
    const command = new DepositCommand();
    await expect(
      command.action(
        eth1Network.accounts()[0],
        null,
        eth1Network.rpcUrl(),
        '32',
        contractAddress
      )
    ).to.not.be.rejected;
  });

  it('Should make a deposit for 10 accounts derived from mnemonic', async () => {
    this.timeout(4000);
    const contractAddress = await eth1Network.deployDepositContract();
    const command = new DepositCommand();
    await expect(
      command.action(
        null,
        eth1Network.mnemonic(),
        eth1Network.rpcUrl(),
        '32',
        contractAddress
      )
    ).to.not.be.rejected;
  });

});
