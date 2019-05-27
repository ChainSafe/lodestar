import {expect} from 'chai';
import {BeaconNodeCommand} from "../../../../src/cli/commands/index";
import logger from "../../../../src/logger/winston";

import program from "commander";

describe('Validator test', () => {

  before(async () => {
    logger.silent(true);
  });

  after(async () => {
    logger.silent(false);
  });

  it('Should be able to register', async () => {
    const command = new BeaconNodeCommand();
    const commandCount = program.commands.length;
    await expect(
      command.register(program)
    ).to.not.throw;
    expect(program.commands.length).to.be.equal(commandCount + 1);
  });

});
