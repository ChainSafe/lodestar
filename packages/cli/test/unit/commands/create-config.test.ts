import {expect} from "chai";
import {CreateConfigCommand} from "../../../src/commands";
import {CliError} from "../../../src//error";
import chaiAsPromised from "chai-as-promised";
import program from "commander";
import chai from "chai";
import {ILogger, WinstonLogger} from "../../../src/logger";

chai.use(chaiAsPromised);

describe("[CLI] create-config", () => {

  let logger: ILogger = new WinstonLogger();
  before(async () => {
    logger.silent = true;
  });

  after(async () => {
    logger.silent = false;
  });

  it("Should be able to register", async () => {
    const command = new CreateConfigCommand();
    const commandCount = program.commands.length;
    await expect(
      command.register(program)
    ).to.not.throw;
    expect(program.commands.length).to.be.equal(commandCount + 1);
  });

  it("Should throw error if output file exists", async () => {
    const command = new CreateConfigCommand();
    await expect(
      command.action({
        outputFile: "src",
        logLevel: null,
      }, logger)
    ).to.be.rejectedWith(CliError, "src already exists");
  });
});
