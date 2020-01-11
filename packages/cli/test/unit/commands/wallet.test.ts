import {expect} from "chai";
import {ILogger, WinstonLogger} from "../../../src/logger";
import {CliError} from "../../../src/error";

import program from "commander";
import {CreateWalletCommand} from "../../../src/commands";


describe("[CLI] wallet", () => {
  
  let logger: ILogger = new WinstonLogger();

  before(() => {
    logger.silent = true;
  });

  after(() => {
    logger.silent = false;
  });

  it("Should be able to register", async () => {
    const command = new CreateWalletCommand();
    const commandCount = program.commands.length;
    await expect(command.register(program)).to.not.throw;
    expect(program.commands.length).to.be.equal(commandCount + 1);
  });

  it("Should throw error if output file exists", async () => {
    const command = new CreateWalletCommand();
    await expect(
      command.action({outputFile: "src"}, logger)
    ).to.be.rejectedWith(CliError, "src already exists");
  });
});
