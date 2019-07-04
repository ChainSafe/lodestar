import {expect, assert} from 'chai';
import {WinstonLogger} from "../../../../src/logger/winston";

import program from "commander";
import {ValidatorCommand} from '../../../../src/cli/commands/validator';
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import {BeaconChain} from "../../../../src/chain";
import * as RPCApis from "../../../../src/rpc/api";
import BeaconNode, {BeaconNodeCtx} from "../../../../src/node";
import {ILogger} from "../../../../src/logger";

describe('[CLI] validator', () => {
  let logger: ILogger = new WinstonLogger();

  let beaconNode: BeaconChain;
  before(async () => {
    logger.silent(true);
  });

  after(() => {
    logger.silent(false);
  });

  it.skip('BeaconNode start testing', async () => {
    let rpcApis = Object.values(RPCApis).filter((api) => api !== undefined);

    let optionsMap: BeaconNodeCtx = {
      rpc: {
        apis: rpcApis
      }
    };

    const node = new BeaconNode(optionsMap, {logger: logger});
    await expect(node.start()).not.throw;
    await node.stop();
  });

});
