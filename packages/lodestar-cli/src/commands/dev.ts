/**
 * @module cli/commands
 */

import { ICliCommand } from "./interface";
import { CommanderStatic } from "commander";
import deepmerge from "deepmerge";
import fs, { mkdirSync } from "fs";
import { join } from "path";
import PeerId from "peer-id";
import yaml from "js-yaml";
import { config as mainnetConfig } from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import rimraf from "rimraf";
import { ILogger, WinstonLogger } from "@chainsafe/eth2.0-utils/lib/logger";
import { BeaconNode } from "@chainsafe/lodestar/lib/node";
import { IBeaconNodeOptions } from "@chainsafe/lodestar/lib/node/options";
import { generateCommanderOptions, optionsToConfig, } from "../util";
import { rmDir } from "@chainsafe/lodestar/lib/util/file";
import { config as minimalConfig } from "@chainsafe/eth2.0-config/lib/presets/minimal";
import { InteropEth1Notifier } from "@chainsafe/lodestar/lib/eth1/impl/interop";
import { quickStartOptionToState } from "../lodestar/interop/cli";
import { initBLS, Keypair, PrivateKey } from "@chainsafe/bls";
import { computeEpochAtSlot, computeStartSlotAtEpoch, getCurrentSlot } from "@chainsafe/eth2.0-state-transition";
import { interopKeypair } from "../lodestar/interop/keypairs";
import { ValidatorApi } from "@chainsafe/lodestar/lib/api/rpc/api/validator";
import { BeaconApi } from "@chainsafe/lodestar/lib/api/rpc/api/beacon";
import { DEPOSIT_CONTRACT_TREE_DEPTH } from "@chainsafe/lodestar/lib/constants";

import { loadPeerId, createNodeJsLibp2p } from "@chainsafe/lodestar/lib/network/nodejs";
import { createPeerId } from "@chainsafe/lodestar/lib/network";
import { ProgressiveMerkleTree } from "@chainsafe/eth2.0-utils";
import { MerkleTreeSerialization } from "@chainsafe/lodestar/lib/util/serialization";
import { ApiClientOverInstance } from "@chainsafe/lodestar-validator/lib/api";
import { ValidatorClient } from "@chainsafe/lodestar/lib/validator/nodejs";
import { BeaconState } from "@chainsafe/eth2.0-types";
import { quickStartState } from "../lodestar/interop/state";
import { default as dbConfig } from "@chainsafe/lodestar/lib/db/options";
import { BeaconNodeOptions } from "../lodestar/node/options";
import { getTomlConfig } from "../lodestar/util/file";

interface IDevCommandOptions {
  loggingLevel?: string;
  genesisTime?: string;
  validatorCount?: string;
  genesisState?: string;
  preset?: string;
  validators?: string;
  [key: string]: string;
}

export class DevCommand implements ICliCommand {
  public node: BeaconNode;

  private validatorDir = "./validators";

  public register(commander: CommanderStatic): void {

    const logger: ILogger = new WinstonLogger();

    //TODO: when we switch cli library make this to run as default command "./bin/lodestar"
    const command = commander
      .command("dev")
      .description("Start lodestar beacon node and certain amount of validator nodes")
      .option("-t, --genesisTime [genesisTime]", "genesis time of Beacon state", Math.round(Date.now() / 1000).toString())
      .option("-c, --validatorCount [validatorCount]", "Number of validator for Beacon state", "8")
      .option("-s, --genesisState [params]", "Start chain from known state")
      // eslint-disable-next-line max-len
      .option("-v, --validators [range]", "Start validators, single number - validators 0-number, x,y - validators between x and y", "8")
      .option("-p, --preset [preset]", "Minimal/mainnet", "minimal")
      .option("-r, --resetDb", "Reset the database", true)
      .option("--peer-id-file [peerIdFile]", "peer id json file")
      .option("--peer-id [peerId]", "peer id hex string")
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
    let conf: Partial<IBeaconNodeOptions> = {};

    //find better place for this once this cli is refactored
    await initBLS();

    //merge config file
    if (options.configFile) {
      const parsedConfig = getTomlConfig(options.configFile, BeaconNodeOptions);
      //cli will override toml config options
      conf = deepmerge(conf, parsedConfig);
    }

    //override current config with cli config
    conf = deepmerge(conf, optionsToConfig(options, BeaconNodeOptions));

    if (options.resetDb) {
      const lodestarDir = "./" + options.db;
      if (fs.existsSync(lodestarDir)) {
        rmDir(lodestarDir);
      }
      if (options.validators && fs.existsSync("./validators")) {
        let start = 0, end = 0;
        if (options.validators.includes(",")) {
          const parts = options.validators.split(",");
          start = parseInt(parts[0]);
          end = parseInt(parts[1]);
        } else {
          end = parseInt(options.validators);
        }
        for (let i = start; i < end; i++) {
          const validatorPath = `./validators/validator-db-${i}`;
          if (fs.existsSync(validatorPath)) {
            rmDir(validatorPath);
          }
        }
      }
    }

    let peerId: PeerId;
    if (options["peerId"]) {
      peerId = PeerId.createFromHexString(options["peerId"]);
    } else if (options["peerIdFile"]) {
      peerId = await loadPeerId(options["peerId"]);
    } else {
      peerId = await createPeerId();
    }
    if (!conf.db) {
      conf.db = {
        name: join('.', '.tmp', 'lodestar-db', peerId.toB58String())
      };
    }
    const libp2p = await createNodeJsLibp2p(peerId, conf.network);
    const config = options.preset === "minimal" ? minimalConfig : mainnetConfig;
    const tree = ProgressiveMerkleTree.empty(DEPOSIT_CONTRACT_TREE_DEPTH, new MerkleTreeSerialization(config));
    let state: BeaconState;
    if (options.genesisState) {
      state = quickStartOptionToState(config, tree, options.genesisState);
    } else if (options.genesisTime && options.validatorCount) {
      logger.info(`Starting node with genesisTime ${new Date(parseInt(options.genesisTime) * 1000)} and \
       ${options.validatorCount} validators.`);
      state = quickStartState(config, tree, parseInt(options.genesisTime), parseInt(options.validatorCount));
    } else {
      throw new Error("Missing either --quickstart or --genesisTime and --validatorCount flag");
    }
    this.node = new BeaconNode(conf, { config, logger, eth1: new InteropEth1Notifier(), libp2p });
    await this.node.chain.initializeBeaconChain(state, tree);

    const targetSlot = computeStartSlotAtEpoch(
      config,
      computeEpochAtSlot(config, getCurrentSlot(config, state.genesisTime))
    );
    await this.node.chain.advanceState(targetSlot);
    rimraf.sync(dbConfig.name);
    await this.node.start();
    if (options.validators) {
      if (options.validators.includes(",")) {
        const rangeParts = options.validators.split(",");
        this.startValidators(parseInt(rangeParts[0]), parseInt(rangeParts[1]), this.node);
      } else {
        this.startValidators(0, parseInt(options.validators), this.node);
      }
    } else if (options.validatorsFromYamlKeyFile) {
      // @ts-ignore
      const keys = yaml.load(fs.readFileSync(options.validatorsFromYamlKeyFile));
      for (const { privkey } of keys) {
        this.startValidator(Buffer.from(privkey.slice(2), "hex"), this.node);
      }
    }
  }

  private async startValidators(from: number, to: number, node: BeaconNode): Promise<void> {
    rimraf.sync(this.validatorDir);
    mkdirSync(this.validatorDir);
    for (let i = from; i < to; i++) {
      this.startValidator(interopKeypair(i).privkey, node);
    }
  }
  private async startValidator(privkey: Buffer, node: BeaconNode): Promise<void> {
    const modules = {
      config: node.config,
      sync: node.sync,
      eth1: node.eth1,
      opPool: node.opPool,
      logger: new WinstonLogger({ module: "API" }),
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
    const validator = new ValidatorClient(
      {
        validatorKey: keypair.privateKey.toHexString(),
        restApi: rpcInstance,
        db: this.validatorDir + "/validator-db-" + index,
        config: node.config
      },
      {
        logger: new WinstonLogger({ module: `Validator #${index}` })
      }
    );
    validator.start();
  }
}
