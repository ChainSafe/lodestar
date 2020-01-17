import {describe} from "mocha";
import {PrivateEth1Network} from "@chainsafe/lodestar/lib/eth1/dev";
import chai, {expect} from "chai";
import {DepositCommand} from "../../../src/commands";
import chaiAsPromised from "chai-as-promised";
import {CliError} from "../../../src/error";
import program from "commander";
import {ILogger, WinstonLogger} from "../../../src/logger";

chai.use(chaiAsPromised);

describe("[CLI] deposit", function() {

  this.timeout(4000);

  let eth1Network: PrivateEth1Network;
  let logger: ILogger = new WinstonLogger();
  logger.silent = true;

  before(async () => {
    eth1Network = new PrivateEth1Network({
      host: "127.0.0.1",
      port: 32567
    },
    {
      logger,
    });
    await eth1Network.start();
  });

  after(async () => {
    await eth1Network.stop();
  });

  it("Should be able to register", async () => {
    const command = new DepositCommand();
    const commandCount = program.commands.length;
    await expect(
      command.register(program)
    ).to.not.throw;
    expect(program.commands.length).to.be.equal(commandCount + 1);
  });

  it("Should throw error if unable to connect to eth1 network", async () => {
    const command = new DepositCommand();
    await expect(
      command.action(
        {
          privateKey: eth1Network.accounts()[0],
          logLevel: null,
          mnemonic: null,
          node:"http://worong_host:123",
          value: "32",
          contract:"0x",
          accounts: 10
        }, logger
      )
    ).to.be.rejectedWith(CliError, "JSON RPC node (http://worong_host:123) not available.");
  });

  it("Should throw error if bot private key and mnemonic are not submitted", async () => {
    const command = new DepositCommand();
    await expect(
      command.action(
        {
          privateKey: null,
          logLevel: null,
          mnemonic: null,
          node: eth1Network.rpcUrl(),
          value: "32",
          contract:"0x",
          accounts: 10
        }, logger
      )
    ).to.be.rejectedWith(CliError, "You have to submit either privateKey or mnemonic.");
  });

  it("Should throw error if mnemonic is invalid", async () => {
    const command = new DepositCommand();
    await expect(
      command.action(
        {
          privateKey: null,
          logLevel: null,
          mnemonic: "invalid mnemonic",
          node: eth1Network.rpcUrl(),
          value: "32",
          contract:"0x",
          accounts: 10
        }, logger
      )
    ).to.be.rejectedWith(Error, "invalid mnemonic");
  });


});
