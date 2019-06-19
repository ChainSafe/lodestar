import {expect, assert} from 'chai';
import {WinstonLogger} from "../../../../src/logger/winston";

import program from "commander";
import {BeaconChain} from "../../../../src/chain";
import {StartCommand} from "../../../../src/cli/commands/start";
import {ILogger} from "../../../../src/logger";

describe('[CLI] start', () => {
  let logger: ILogger = new WinstonLogger();

  let beaconNode: BeaconChain;
  before(async () => {
    logger.silent(true);
  });

  after(() => {
    logger.silent(false);
  });

  it('Should be able to register', async () => {
    const command = new StartCommand();
    const commandCount = program.commands.length;
    await expect(command.register(program)).to.not.throw;
    expect(program.commands.length).to.be.equal(commandCount + 1);
  });

});
