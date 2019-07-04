import {PrivateEth1Network} from "../../../../eth1/dev";
import chai, {expect} from 'chai';
import {DepositCommand} from "../../../../cli/commands";
import chaiAsPromised from 'chai-as-promised';
import {ILogger, WinstonLogger} from "../../../../logger";

chai.use(chaiAsPromised);

describe('[CLI] deposit', function() {

  let eth1Network: PrivateEth1Network;
  const logger: ILogger = new WinstonLogger();

  before(async function() {
    this.timeout(0);
    logger.silent(true);
    eth1Network = new PrivateEth1Network({
      host: '127.0.0.1',
      port: 32567
    },
    {
      logger: logger
    }
    );
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
        {
          privateKey:eth1Network.accounts()[0],
          loggingLevel:null,
          mnemonic:null,
          node:eth1Network.rpcUrl(),
          value:'32',
          contract:contractAddress,
          accounts: 10
        }, logger
      )
    ).to.not.be.rejected;
  });

  it('Should make a deposit for 10 accounts derived from mnemonic', async function() {
    this.timeout(0);
    const contractAddress = await eth1Network.deployDepositContract();
    const command = new DepositCommand();
    await expect(
      command.action(
        {
          privateKey:null,
          loggingLevel:null,
          mnemonic:eth1Network.mnemonic(),
          node:eth1Network.rpcUrl(),
          value:'32',
          contract:contractAddress,
          accounts: 10
        }, logger
      )
    ).to.not.be.rejected;
  });

});
