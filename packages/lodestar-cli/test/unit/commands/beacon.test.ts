import {expect} from "chai";
import {BeaconNodeCommand} from "../../../src/commands/index";

import program from "commander";
import {ILogger, WinstonLogger} from "@chainsafe/eth2.0-utils/lib/logger";



describe("[CLI] beacon", () => {
  let logger: ILogger = new WinstonLogger();

  before(async () => {
    logger.silent = true;
  });

  after(async () => {
    logger.silent = false;
  });

  it("Should be able to register", async () => {
    const command = new BeaconNodeCommand();
    const commandCount = program.commands.length;
    await expect(
      command.register(program)
    ).to.not.throw;
    expect(program.commands.length).to.be.equal(commandCount + 1);
    // command.action({
    //   loggingLevel: "chain = debug",
    // });
  });

});
