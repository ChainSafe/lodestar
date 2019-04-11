import logger from "../../../src/logger";
import {PrivateEth1Network} from "../../../src/eth1/dev";
import {Wallet} from "ethers";
import * as ethers from "ethers/ethers";
import {expect} from "chai";

describe('Eth1 dev network', () => {

  before(() => {
    logger.silent(true);
  });

  after(() => {
    logger.silent(false);
  });

  it('should start as configured', async () => {
    const network = new PrivateEth1Network({
      host: '127.0.0.1',
      port: 34567,
      mnemonic: 'test',
      default_balance_ether: 1400
    });
    await network.start();
    const accountBalance = await new Wallet(network.accounts()[0]).getBalance();
    expect(accountBalance.toString()).to.be.equal(ethers.utils.parseEther('1400').toString());
    expect(network.rpcUrl()).to.be.equal('http://127.0.0.1:34567');
    expect(network.mnemonic()).to.be.equal('test');
    expect(network.accounts().length).to.be.equal(10);
    await network.stop();
  });

  it('should deploy deposit contract', async () => {
    const network = new PrivateEth1Network({
      host: '127.0.0.1',
      port: 34567,
      mnemonic: 'test',
      default_balance_ether: 1400
    });
    await network.start();
    const address = await network.deployDepositContract();
    expect(address).to.not.be.null;
    await network.stop();
  });
});
