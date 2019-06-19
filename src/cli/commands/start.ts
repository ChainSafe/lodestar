/**
 * @module cli/commands
 */
import fs from "fs";
import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import logger, {LogLevel} from "../../logger";
import BeaconNode, {BeaconNodeCtx} from "../../node";
import {RpcClientOverInstance, RpcClientOverWs} from "../../validator/rpc";
import {ValidatorCtx} from "../../validator/types";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import Validator from "../../validator";
import defaults from "../../validator/defaults";
import {BeaconApi} from "../../rpc/api/beacon";
import {BeaconDB, ValidatorDB} from "../../db/api";
import {BeaconChain} from "../../chain";
import {ValidatorApi} from "../../rpc/api/validator";
import {LevelDbPersistance} from "../../db/persistance";
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import Keystore from "../../validator/keystore";
import {promptPassword} from "../../util/io";
import {BeaconNodeCommand} from "./beacon";

interface IStartCommandOptions {
  db: string;
  depositContract: string;
  eth1RpcUrl: string;
  rpc: string;
  configFile: string;
  key: string;
  dbValidator: string;
  loggingLevel: string;
}

export class StartCommand implements CliCommand {

  public register(commander: CommanderStatic): void {
    commander
      .command("start")
      .description("Start lodestar node and bundled validator")
      .option("--db [db_path]", "Path to Beacon node database")
      .option("-dc, --depositContract [address]", "Address of deposit contract")
      .option("-eth1, --eth1RpcUrl [url]", "Url to eth1 rpc node")
      .option("--rpc [api]", "Exposes the selected RPC api, must be comma separated")
      .option("-c, --configFile [config_file]", "Config file path")

      .option("-k, --key [key]", "Private key of the validator")
      .option("--dbValidator [db_path]", "Path to the validator database")
      .option(`-l, --loggingLevel [${Object.values(LogLevel).join("|")}]`, "Logging level")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          let nodeCommand = new BeaconNodeCommand();
          await nodeCommand.action(options);
          await this.action(options, nodeCommand.node);
        } catch (e) {
          logger.error(e.message + '\n' + e.stack);
        }
      });
  }

  public async action(options: IStartCommandOptions, node: BeaconNode): Promise<void> {
    if (options.loggingLevel) {
      logger.setLogLevel(LogLevel[options.loggingLevel]);
    }

    let dbName: string;
    if (options.dbValidator) {
      dbName = options.dbValidator;
    } else {
      dbName = defaults.db.name;
    }
    let db = new ValidatorDB({
      persistance: new LevelDbPersistance({
        name: dbName
      })
    });

    const rpcClient = new RpcClientOverInstance({
      beacon: new BeaconApi({}, {chain: node.chain, db: node.db}),
      validator: new ValidatorApi({},{chain:node.chain, db: node.db, opPool: node.opPool})
    });

    let keypair: Keypair;
    if(options.key){
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

    let validator = new Validator(validatorCtx);
    await validator.start();
  }

  public async getKeyFromKeyStore(keyStorePath: string): Promise<Keypair> {
    const password = await promptPassword("Enter password to decrypt the keystore: ");

    const keystore = Keystore.fromJson(keyStorePath);
    return keystore.getKeypair(password);
  }

}
