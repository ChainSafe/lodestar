import {PrivateEth1Network} from "../../../../src/eth1/dev/index";
import chai, {expect} from 'chai';
import {DepositCommand} from "../../../../src/cli/commands/index";
import chaiAsPromised from 'chai-as-promised';
import logger from "../../../../src/logger/winston";
import {CliError} from "../../../../src/cli/error";
import {Wallet} from "ethers";
import program from "commander";

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
        eth1Network.accounts()[0],
        null,
        'http://worong_host:123',
        '32',
        '0x'
      )
    ).to.be.rejectedWith(CliError, 'JSON RPC node (http://worong_host:123) not available.')
  });

  it('Should throw error if bot private key and mnemonic are not submitted', async () => {
    const command = new DepositCommand();
    await expect(
      command.action(
        null,
        null,
        eth1Network.rpcUrl(),
        '32',
        '0x'
      )
    ).to.be.rejectedWith(CliError, 'You have to submit either privateKey or mnemonic.');
  });

  it('Should throw error if mnemonic is invalid', async () => {
    const command = new DepositCommand();
    await expect(
      command.action(
        null,
        'invalid mnemonic',
        eth1Network.rpcUrl(),
        '32',
        '0x'
      )
    ).to.be.rejectedWith(Error, 'invalid mnemonic');
  });

  it('Should throw error if contract doesn\'t exist', async () => {
    const command = new DepositCommand();
    await expect(
      command.action(
        eth1Network.accounts()[0],
        null,
        eth1Network.rpcUrl(),
        '32',
        Wallet.createRandom().address
      )
    ).to.be.rejectedWith(CliError, 'Failed to make deposit for account');
  });


});
