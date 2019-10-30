import {describe} from "mocha";
import mockery from "mockery";
import program from "commander";

import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {ILogger, WinstonLogger} from "../../../../lib/logger";
import sinon from "sinon";


chai.use(chaiAsPromised);

describe('[CLI] interop', function() {
  this.timeout(0);
  let logger: ILogger = new WinstonLogger();
  logger.silent = true;
  let DevCommand: any;

  before(function () {
    mockery.registerMock('libp2p', sinon.stub());
    mockery.enable({useCleanCache: true, warnOnReplace: false, warnOnUnregistered: false});
    DevCommand = require("../../../../src/cli/commands").DevCommand;
  });

  after(function () {
    mockery.deregisterMock("libp2p");
    mockery.disable();
  });


  it('should be able to register', async () => {
    const command = new DevCommand();
    const commandCount = program.commands.length;
    await expect(
      command.register(program)
    ).to.not.throw;
    expect(program.commands.length).to.be.equal(commandCount + 1);
  });

  it('should throw error if missing quickstart and genesisTime and validatorCount', async () => {
    const command = new DevCommand();
    await expect(
      command.action(
        {
          multiaddrs: ","
        }, logger
      )
    ).to.be.rejectedWith(Error, 'Missing either --quickstart or --genesisTime and --validatorCount flag');
  });
});