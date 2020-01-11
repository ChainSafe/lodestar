import {expect} from "chai";
import {ILogger, WinstonLogger} from "../../../src/logger";
import program from "commander";
import {ValidatorCommand} from "../../../src/commands";

describe("[CLI] validator", () => {
  const logger: ILogger = new WinstonLogger();

  before(async () => {
    logger.silent = true;
  });

  after(() => {
    logger.silent = false;
  });

  it("Should be able to register", async () => {
    const command = new ValidatorCommand();
    const commandCount = program.commands.length;
    await expect(command.register(program)).to.not.throw;
    expect(program.commands.length).to.be.equal(commandCount + 1);
  });

  it.skip("Should be able to run", async () => {
    const keyString = "0xce19243b40ececffe739ddd6b2306be0d8dbd2be0b7dff9bacb419bfbacfa7a7";
    const command = new ValidatorCommand();
    await expect(
      command.action({
        key:keyString,
        logLevel: "info",
      }, logger)

    ).not.throw;
  });

});
