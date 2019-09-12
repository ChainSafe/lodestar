/**
 * @module cli/commands
 */

import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import deepmerge from "deepmerge";
import fs from "fs";

import {config as mainnetConfig} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {ILogger, WinstonLogger} from "../../logger";
import {BeaconNode} from "../../node";
import {BeaconNodeOptions, IBeaconNodeOptions} from "../../node/options";
import {generateCommanderOptions, optionsToConfig,} from "../util";
import {rmDir} from "../../util/file";
import {getTomlConfig} from "../../util/file";
import Validator from "../../validator";
import {config as minimalConfig} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {InteropEth1Notifier} from "../../eth1/impl/interop";
import {quickStartOptionToState} from "../../interop/cli";
import {ProgressiveMerkleTree} from "../../util/merkleTree";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {interopKeypair} from "../../interop/keypairs";
import {RpcClientOverInstance} from "../../validator/rpc";
import {ValidatorApi} from "../../api/rpc/api/validator";
import {BeaconApi} from "../../api/rpc/api/beacon";
import {existsSync, mkdirSync} from "fs";
import {DEPOSIT_CONTRACT_TREE_DEPTH} from "../../constants";
import {intDiv} from "../../util/math";
import {signingRoot} from "@chainsafe/ssz";
import { OperationsModule } from "../../opPool/modules/abstract";
import { parse } from "url";
import { loadPeerId, NodejsNode } from "../../network/nodejs";
import { initializePeerInfo, createPeerId } from "../../network";
import {OperationsModule} from "../../opPool/modules/abstract";
import {parse} from "url";
import {computeEpochOfSlot, computeStartSlotOfEpoch, getCurrentEpoch} from "../../chain/stateTransition/util";
import {getCurrentSlot} from "../../chain/stateTransition/util/genesis";
import Queue from "queue";

interface IInteropCommandOptions {
  loggingLevel?: string;
  quickStart?: string;
  preset?: string;
  validators?: string;
  [key: string]: string;
}

export class InteropCommand implements CliCommand {
  public node: BeaconNode;
  public validator: Validator;

  public register(commander: CommanderStatic): void {

    const logger: ILogger = new WinstonLogger();

    //TODO: when we switch cli library make this to run as default command "./bin/lodestar"
    const command = commander
      .command("interop")
      .description("Start lodestar beacon node and certain amount of validator nodes")
      .option("-q, --quickStart [params]", "Start chain from known state")
      .option("-v, --validators [range]", "Start validators, single number - validators 0-number, x,y - validators between x and y", 0)
      .option("-p, --preset [preset]", "Minimal/mainnet", "mainnet")
      .option("-r, --resetDb", "Reset the database", true)
      .option("--peer-id [peerId]","peer id json file")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          await this.action(options, logger);
        } catch (e) {
          logger.error(e.message + '\n' + e.stack);
        }
      });
    generateCommanderOptions(command, BeaconNodeOptions);
  }

  public async action(options: IInteropCommandOptions, logger: ILogger): Promise<void> {
    let conf: Partial<IBeaconNodeOptions> = {};

    //merge config file
    if (options.configFile) {
      let parsedConfig = getTomlConfig(options.configFile, BeaconNodeOptions);
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
        if(options.validators.includes(",")) {
          const parts = options.validators.split(",");
          start = parseInt(parts[0]);
          end = parseInt(parts[1]);
        } else {
          end = parseInt(options.validators);
        }
        for (let i = start; i < end; i++) {
          const validatorPath = `./validators/validator-db-${i}`;
          if(fs.existsSync(validatorPath)) {
            rmDir(validatorPath);
          }
        }
      }
    }

    let peerId;
    if (options["peerId"]) {
      peerId = loadPeerId(options["peerId"]);
    } else {
      peerId = createPeerId();
    }
    const libp2p = await peerId
      .then((peerId) => initializePeerInfo(peerId, conf.network.multiaddrs))
      .then((peerInfo) => new NodejsNode({peerInfo, bootnodes: conf.network.bootnodes}));
    const config = options.preset === "minimal" ? minimalConfig : mainnetConfig;
    if (options.quickStart) {
      this.node = new BeaconNode(conf, {config, logger, eth1: new InteropEth1Notifier(), libp2p});
      const tree = ProgressiveMerkleTree.empty(DEPOSIT_CONTRACT_TREE_DEPTH);
      const state = quickStartOptionToState(config, tree, options.quickStart);
      await this.node.chain.initializeBeaconChain(state, tree);
      const targetSlot = computeStartSlotOfEpoch(config, computeEpochOfSlot(config, getCurrentSlot(config, state.genesisTime)));
      await this.node.chain.advanceState(targetSlot);
    } else {
      throw new Error("Missing --quickstart flag");
    }
    await this.node.start();
    if(options.validators) {
      if(options.validators.includes(",")) {
        const rangeParts = options.validators.split(",");
        this.startValidators(parseInt(rangeParts[0]), parseInt(rangeParts[1]), this.node);
      } else {
        this.startValidators(0, parseInt(options.validators), this.node);
      }
    }
  }

  private async startValidators(from: number, to: number, node: BeaconNode): Promise<void> {
    const validatorDir = './validators';
    if(!existsSync(validatorDir)) {
      mkdirSync(validatorDir);
    }
    for(let i = from; i < to; i++) {
      const modules = {
        config: node.config,
        sync: node.sync,
        eth1: node.eth1,
        opPool: node.opPool,
        logger: new WinstonLogger({module: "API"}),
        chain: node.chain,
        db: node.db
      };
      const rpcInstance = new RpcClientOverInstance({
        config: node.config,
        validator: new ValidatorApi({}, modules),
        beacon: new BeaconApi({}, modules),
      });
      const keypair = new Keypair(PrivateKey.fromBytes(interopKeypair(i).privkey));
      const index = await node.db.getValidatorIndex(keypair.publicKey.toBytesCompressed());
      const validator = new Validator(
        {keypair, rpcInstance, db: {name: validatorDir + '/validator-db-' + index}},
        {config: node.config, logger: new WinstonLogger({module: `Validator #${index}`})});
      validator.start();
    }
  }



}
