import {expect, assert} from 'chai';
import logger from "../../../../src/logger/winston";

import program from "commander";
import {ValidatorCommand} from '../../../../src/cli/commands/validator';
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import {BeaconChain} from "../../../../src/chain";
import * as RPCApis from "../../../../src/rpc/api";
import BeaconNode, {BeaconNodeCtx} from "../../../../src/node";

describe('Validator test', () => {

  let beaconNode: BeaconChain;
  before(async () => {
    logger.silent(true);
  });

  after(() => {
    logger.silent(false);
  });

  it.skip('BeaconNode start testing', async () => {
    // logger.setLogLevel(LogLevel.INFO);
    // let key = PrivateKey.random();
    // logger.info(key.toHexString());

    let rpcApis = Object.values(RPCApis).filter((api) => api !== undefined);

    let optionsMap: BeaconNodeCtx = {
      rpc: {
        apis: rpcApis
      }
    };

    const node = new BeaconNode(optionsMap);
    await expect(node.start()).not.throw;
    await node.stop();
  });

  it('Should be able to register', async () => {
    const command = new ValidatorCommand();
    const commandCount = program.commands.length;
    await expect(command.register(program)).to.not.throw;
    expect(program.commands.length).to.be.equal(commandCount + 1);
  });

  it.skip('Should be able to run', async () => {
    let keyString = "0xce19243b40ececffe739ddd6b2306be0d8dbd2be0b7dff9bacb419bfbacfa7a7";
    const command = new ValidatorCommand();
    await expect(
      command.action({
        key:keyString
      })
    ).not.throw;
  });

});
