import {expect} from "chai";
import {Eth1PrivateNetworkCommand} from "../../../src/commands/index";

import program from "commander";
import {ILogger, WinstonLogger} from "../../../src/logger";

describe("[CLI] eth1:dev", function () {
  this.timeout(4000);

  let logger: ILogger = new WinstonLogger();

  before(async () => {
    logger.silent = true;
  });

  after(async () => {
    logger.silent = false;
  });

  it("Should be able to register", async () => {
    const command = new Eth1PrivateNetworkCommand();
    const commandCount = program.commands.length;
    await expect(
      command.register(program)
    ).to.not.throw;
    expect(program.commands.length).to.be.equal(commandCount + 1);
  });

  it("Should start private network", async () => {
    const command = new Eth1PrivateNetworkCommand();
    const network = await command.action({
      host:"127.0.0.1",
      port:33323,
      logLevel: "error",
      network: null,
      mnemonic: null,
      database:null
    }, logger);
    expect(network).to.not.be.null;
    await network.stop();
  });

});
