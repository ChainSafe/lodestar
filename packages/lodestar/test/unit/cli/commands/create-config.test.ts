import {expect} from 'chai';
import {CreateConfigCommand} from "../../../../src/cli/commands/index";
import {CliError} from "../../../../src/cli/error";

import program from "commander";
import {ILogger, WinstonLogger} from "../../../../src/logger";


describe('[CLI] create-config', () => {

  let logger: ILogger = new WinstonLogger();
  before(async () => {
    logger.silent = true;
  });

  after(async () => {
    logger.silent = false;
  });

  it('Should be able to register', async () => {
    const command = new CreateConfigCommand();
    const commandCount = program.commands.length;
    await expect(
      command.register(program)
    ).to.not.throw;
    expect(program.commands.length).to.be.equal(commandCount + 1);
  });

  it('Should throw error if output file exists', async () => {
    const command = new CreateConfigCommand();
    await expect(
      command.action({
        outputFile: "src",
        logLevel: null,
      }, logger)
    ).to.be.rejectedWith(CliError, 'src already exists');
  });
});
