/**
 * @module cli/commands
 */

import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import logger, {LogLevel} from "../../logger";
import defaults from "../../node/defaults";
import {BeaconNodeCtx} from "../../node";
import {RpcClientOverInstance} from "../../validator/rpc";
import {MockBeaconApi} from "../../../test/utils/mocks/rpc/beacon";
import {MockValidatorApi} from "../../../test/utils/mocks/rpc/validator";
import {ValidatorCtx} from "../../validator/types";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import Validator from "../../validator";
import {expect} from "chai";

interface IValidatorCommandOptions {
  key: string;
  db: string;
  rpc: string;
  loggingLevel: string;
}

export class ValidatorCommand implements CliCommand {

  public register(commander: CommanderStatic): void {
    commander
      .command("beacon")
      .description("Start lodestar node")
      .option("-k, --key [db_path]", "Path to the keystore")
      .option("-d, --db [db_path]", "Path to file database")
      .option("--rpc [api]", "Exposes the selected RPC api, must be comma separated")
      .option(`-l, --loggingLevel [${Object.values(LogLevel).join("|")}]`, "Logging level")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          await this.action(options);
        } catch (e) {
          logger.error(e.message + '\n' + e.stack);
        }
      });
  }

  public async action(options: IValidatorCommandOptions): Promise<void> {
    if (options.loggingLevel) {
      logger.setLogLevel(LogLevel[options.loggingLevel]);
    }

    let dbName: string;
    if (options.db) {
      dbName = options.db;
    } else {
      dbName = defaults.db.name;
    }

    const rpcClient = new RpcClientOverInstance({
      beacon: new MockBeaconApi({
        genesisTime: Date.now() / 1000
      }),
      validator: new MockValidatorApi(),
    });

    let validatorCtx: ValidatorCtx = {
      rpc: rpcClient,
      keypair: Keypair.generate(),
    };

    let validator = new Validator(validatorCtx);
    await expect(validator.setup()).to.not.throw;
  }
}
