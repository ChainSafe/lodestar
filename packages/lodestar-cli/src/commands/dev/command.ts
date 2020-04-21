/**
 * @module cli/commands
 */
process.setMaxListeners(15);
import {ICliCommand} from "../interface";
import {CommanderStatic} from "commander";
import fs from "fs";
import path, {join, resolve} from "path";
import yaml from "js-yaml";
import {ENR} from "@chainsafe/discv5";
import {config as mainnetConfig} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {generateCommanderOptions,} from "../../util";
import {config as minimalConfig} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {InteropEth1Notifier} from "@chainsafe/lodestar/lib/eth1/impl/interop";
import {initBLS, Keypair, PrivateKey} from "@chainsafe/bls";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {interopKeypair} from "../../lodestar/interop/keypairs";
import {ApiClientOverInstance} from "@chainsafe/lodestar-validator/lib/api";
import {ValidatorClient} from "@chainsafe/lodestar/lib/validator/nodejs";
import {BeaconState} from "@chainsafe/lodestar-types";
import {BeaconApi, ValidatorApi} from "@chainsafe/lodestar/lib/api/impl";
import {BeaconNodeOptions} from "../../lodestar/node/options";
import {getConfig, getDevGenesisState, getPeerId, resetPath} from "./utils";
import deepmerge from "deepmerge";
import {isPlainObject} from "@chainsafe/lodestar-utils";

export interface IDevCommandOptions {
  [key: string]: string;
  loggingLevel?: string;
  genesisTime?: string;
  validatorCount?: string;
  genesisState?: string;
  preset?: string;
  validators?: string;
  db?: string;
}

const BASE_DIRECTORY = path.join(".", ".tmp");

export class DevCommand implements ICliCommand {
  public node: BeaconNode;
  public validators: ValidatorClient[] = [];


  public register(commander: CommanderStatic): void {

    const logger: ILogger = new WinstonLogger();

    const command = commander
      .command("dev")
      .description("Start lodestar beacon node and certain amount of validator nodes")
      .option("-t, --genesisTime [genesisTime]", "genesis time of Beacon state", Math.floor(Date.now()/1000).toString())
      .option("-c, --validatorCount [validatorCount]", "Number of validator for Beacon state")
      .option("-s, --genesisState [params]", "Start chain from known state", path.join(BASE_DIRECTORY, "state.ssz"))
      .option(
        "-v, --validators [range]",
        "Start validators, single number - validators 0-number, x,y - validators between x and y",
        "8"
      )
      .option("-p, --preset [preset]", "Minimal/mainnet", "minimal")
      .option("-r, --resetDb", "Reset the database", true)
      .option("--peer-id [peerId]", "peer id hex string or json file path")
      .option("--validators-from-yaml-key-file [validatorsYamlFile]", "validator keys")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          await this.action(options, logger);
        } catch (e) {
          logger.error(e.message + "\n" + e.stack);
        }
      });
    generateCommanderOptions(command, BeaconNodeOptions);
  }

  public async action(options: IDevCommandOptions, logger: ILogger): Promise<void> {
    //find better place for this once this cli is refactored
    await initBLS();

    const conf: Partial<IBeaconNodeOptions> = getConfig(options);

    const peerId = await getPeerId(options.peerId);

    if (!conf.db) {
      conf.db = {
        name: join(BASE_DIRECTORY, "lodestar-db", peerId.toB58String())
      };
    }
    resetPath(conf.db.name);
    conf.network = deepmerge(
      conf.network || {},
      {discv5: {enr: ENR.createFromPeerId(peerId), bindAddr: "/ip4/127.0.0.1/udp/0"}},
      {isMergeableObject: isPlainObject}
    );
    const libp2p = await createNodeJsLibp2p(peerId, conf.network);

    const config = options.preset === "minimal" ? minimalConfig : mainnetConfig;
    const depositDataRootList = config.types.DepositDataRootList.tree.defaultValue();
    const state: BeaconState = getDevGenesisState(options, config, depositDataRootList);
    if(options.validatorCount) {
      logger.info(`Generating new genesis state and storing to ${resolve(options.genesisState)}`);
      fs.writeFileSync(options.genesisState, config.types.BeaconState.serialize(state));
    }
    logger.info("Running dev beacon chain with genesis time"
            + ` ${state.genesisTime} (${new Date(state.genesisTime * 1000)}) `
            +`and ${state.validators.length} validators`
    );

    this.node = new BeaconNode(conf, {config, logger, eth1: new InteropEth1Notifier(), libp2p});
    await this.node.chain.initializeBeaconChain(state, depositDataRootList);
    await this.node.start();

    if (options.validators) {
      if (options.validators.includes(",")) {
        const rangeParts = options.validators.split(",");
        this.startValidators(parseInt(rangeParts[0]), parseInt(rangeParts[1]), this.node, options);
      } else {
        this.startValidators(0, parseInt(options.validators), this.node, options);
      }
    } else if (options.validatorsFromYamlKeyFile) {
      // @ts-ignore
      const keys = yaml.load(fs.readFileSync(options.validatorsFromYamlKeyFile));
      for (const {privkey} of keys) {
        this.startValidator(Buffer.from(privkey.slice(2), "hex"), this.node, options);
      }
    }
  }

  private async startValidators(
    from: number, to: number, node: BeaconNode, options: IDevCommandOptions
  ): Promise<void> {
    for (let i = from; i < to; i++) {
      this.startValidator(interopKeypair(i).privkey, node, options);
    }
  }

  private async startValidator(privkey: Buffer, node: BeaconNode, options: IDevCommandOptions): Promise<void> {
    const modules = {
      config: node.config,
      sync: node.sync,
      eth1: node.eth1,
      opPool: node.opPool,
      logger: new WinstonLogger({module: "API"}),
      chain: node.chain,
      network: node.network,
      db: node.db
    };
    const rpcInstance = new ApiClientOverInstance({
      config: node.config,
      validator: new ValidatorApi({}, modules),
      beacon: new BeaconApi({}, modules),
    });
    const keypair = new Keypair(PrivateKey.fromBytes(privkey));
    const index = await node.db.getValidatorIndex(keypair.publicKey.toBytesCompressed());
    const validatorDbPath = path.join(".", ".tmp", "validator-db-" + index);
    if(options.resetDb) {
      resetPath(validatorDbPath);
    }
    const validator = new ValidatorClient(
      {
        validatorKey: keypair.privateKey.toHexString(),
        restApi: rpcInstance,
        db: validatorDbPath,
        config: node.config
      },
      {
        logger: new WinstonLogger({module: `Validator #${index}`})
      }
    );
    this.validators.push(validator);
    validator.start();
  }
}
