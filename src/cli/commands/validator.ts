/**
 * @module cli/commands
 */
import fs from "fs";
import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import {ILogger, LogLevel, WinstonLogger} from "../../logger";
import {BeaconNodeCtx} from "../../node";
import {RpcClientOverInstance, RpcClientOverWs} from "../../validator/rpc";
import {MockBeaconApi} from "../../../test/utils/mocks/rpc/beacon";
import {MockValidatorApi} from "../../../test/utils/mocks/rpc/validator";
import {ValidatorCtx} from "../../validator/types";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import Validator from "../../validator";
import {expect} from "chai";
import defaults from "../../validator/defaults";
import {BeaconApi} from "../../rpc/api/beacon";
import {BeaconDB, ValidatorDB} from "../../db/api";
import {BeaconChain} from "../../chain";
import {ValidatorApi} from "../../rpc/api/validator";
import {OpPool} from "../../opPool";
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import Keystore from "../../validator/keystore";
import {promptPassword} from "../../util/io";
import {LevelDbController} from "../../db/controller";

interface IValidatorCommandOptions {
  key: string;
  db?: string;
  rpc?: string;
  loggingLevel?: string;
}

export class ValidatorCommand implements CliCommand {

  public register(commander: CommanderStatic): void {
    const logger: ILogger = new WinstonLogger();

    commander
      .command("beacon")
      .description("Start lodestar node")
      .option("-k, --key [key]", "Private key of the validator")
      .option("-d, --db [db_path]", "Path to file database")
      .option("--rpc [rpcUrl]", "RpcUrl of a running Beacon node to connect with")
      .option(`-l, --loggingLevel [${Object.values(LogLevel).join("|")}]`, "Logging level")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          await this.action(options, logger);
        } catch (e) {
          logger.error(e.message + '\n' + e.stack);
        }
      });
  }

  public async action(options: IValidatorCommandOptions, logger: ILogger): Promise<void> {
    if (options.loggingLevel) {
      logger.setLogLevel(LogLevel[options.loggingLevel]);
    }

    let dbName: string;
    if (options.db) {
      dbName = options.db;
    } else {
      dbName = defaults.db.name;
    }
    let db = new ValidatorDB({
      controller: new LevelDbController({
        name: dbName
      }, {
        logger: logger
      })
    });

    let rpcClient: RpcClientOverWs;
    if (options.rpc) {
      rpcClient = new RpcClientOverWs({
        rpcUrl: options.rpc
      });
    } else {
      rpcClient = new RpcClientOverWs({
        rpcUrl: defaults.rpc.rpcUrl
      });
    }

    let keypair: Keypair;
    if (options.key) {
      if (fs.existsSync(options.key)) {
        keypair = await this.getKeyFromKeyStore(options.key);
      } else {
        keypair = new Keypair(PrivateKey.fromHexString(options.key));
      }
    } else {
      throw new Error("Provide keystore file path or private key.");
    }

    let validatorCtx: ValidatorCtx = {
      rpc: rpcClient,
      keypair: keypair,
      db: db,
    };

    let validator = new Validator(validatorCtx, logger);
    await validator.start();
  }

  public async getKeyFromKeyStore(keyStorePath: string): Promise<Keypair> {
    const password = await promptPassword("Enter password to decrypt the keystore: ");

    const keystore = Keystore.fromJson(keyStorePath);
    return keystore.getKeypair(password);
  }

}
