import {PrivateEth1Network} from "../../../../src/eth1/dev";
import chai, {expect} from 'chai';
import {DepositCommand} from "../../../../src/cli/commands";
import chaiAsPromised from 'chai-as-promised';
import {CliError} from "../../../../src/cli/error";
import {Wallet} from "ethers";
import program from "commander";
import {ILogger, WinstonLogger} from "../../../../src/logger";

chai.use(chaiAsPromised);

describe('[CLI] deposit', function() {

  let eth1Network: PrivateEth1Network;
  let logger: ILogger = new WinstonLogger();

  before(async () => {
    logger.silent(true);
    eth1Network = new PrivateEth1Network({
      host: '127.0.0.1',
      port: 32567
    },
    {
      logger: logger
    });
    await eth1Network.start();
  });

  after(async () => {
    await eth1Network.stop();
    logger.silent(false);
  });

  it('Should be able to register', async () => {
    const command = new DepositCommand();
    const commandCount = program.commands.length;
    await expect(
      command.register(program)
    ).to.not.throw;
    expect(program.commands.length).to.be.equal(commandCount + 1);
  });

  it('Should throw error if unable to connect to eth1 network', async () => {
    const command = new DepositCommand();
    await expect(
      command.action(
        {
          privateKey: eth1Network.accounts()[0],
          loggingLevel: null,
          mnemonic: null,
          node:'http://worong_host:123',
          value: '32',
          contract:'0x',
          accounts: 10
        },
        logger
      )
    ).to.be.rejectedWith(CliError, 'JSON RPC node (http://worong_host:123) not available.');
  });

  it('Should throw error if bot private key and mnemonic are not submitted', async () => {
    const command = new DepositCommand();
    await expect(
      command.action(
        {
          privateKey: null,
          loggingLevel: null,
          mnemonic: null,
          node: eth1Network.rpcUrl(),
          value: '32',
          contract:'0x',
          accounts: 10
        },
        logger
      )
    ).to.be.rejectedWith(CliError, 'You have to submit either privateKey or mnemonic.');
  });

  it('Should throw error if mnemonic is invalid', async () => {
    const command = new DepositCommand();
    await expect(
      command.action(
        {
          privateKey: null,
          loggingLevel: null,
          mnemonic: 'invalid mnemonic',
          node: eth1Network.rpcUrl(),
          value: '32',
          contract:'0x',
          accounts: 10
        },
        logger
      )
    ).to.be.rejectedWith(Error, 'invalid mnemonic');
  });
  //
  // it('Should throw error if contract doesn\'t exist', async () => {
  //   const command = new DepositCommand();
  //   await expect(
  //     command.action(
  //       {
  //         privateKey: eth1Network.accounts()[0],
  //         loggingLevel: null,
  //         mnemonic: null,
  //         node: eth1Network.rpcUrl(),
  //         value: '32',
  //         contract: Wallet.createRandom().address,
  //         accounts: 10
  //       }
  //     )
  //   ).to.be.rejectedWith(Error, 'contract not deployed');
  // });


});
