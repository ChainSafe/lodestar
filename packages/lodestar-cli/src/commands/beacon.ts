/**
 * @module cli/commands
 */

import {ICliCommand} from "./interface";
import {CommanderStatic} from "commander";
import deepmerge from "deepmerge";
import {config as mainnetConfig} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {config as minimalConfig} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {ILogger, LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {generateCommanderOptions, optionsToConfig} from "../util";
import {BeaconNodeOptions} from "../lodestar/node/options";
import {getTomlConfig} from "../lodestar/util/file";
import {createNodeJsLibp2p, loadPeerIdFromJsonFile} from "@chainsafe/lodestar/lib/network/nodejs";
import {ENR} from "@chainsafe/discv5";
import {initBLS} from "@chainsafe/bls";
import fs from "fs";
import {load} from "js-yaml";

interface IBeaconCommandOptions {
  [key: string]: string;
  peerId: string;
  forkFile?: string;
  configFile?: string;
  preset?: string;
  loggingLevel?: string;
  eth1BlockNum?: string;
}

export class BeaconNodeCommand implements ICliCommand {
  // @ts-ignore
  public node: BeaconNode;

  public register(commander: CommanderStatic): void {

    const logger = new WinstonLogger();
    //TODO: when we switch cli library make this to run as default command "./bin/lodestar"
    const command = commander
      .command("beacon")
      .description("Start lodestar node")
      .option("-c, --configFile [config_file]", "Config file path")
      .option("-p, --preset [preset]", "Minimal/mainnet", "minimal")
      .option("--peer-id [peerId]", "json file path")
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

  public async action(cmdOptions: IBeaconCommandOptions, logger: ILogger): Promise<BeaconNode> {
    let nodeOptions: Partial<IBeaconNodeOptions> = {};
    //find better place for this once this cli is refactored
    await initBLS();

    if (cmdOptions.loggingLevel) {
      // eslint-disable-next-line no-undef
      // @ts-ignore
      logger.setLogLevel(LogLevel[cmdOptions.loggingLevel]);
    }

    //merge config file
    if (cmdOptions.configFile) {
      const parsedConfig = getTomlConfig(cmdOptions.configFile, BeaconNodeOptions);
      //cli will override toml config options
      nodeOptions = deepmerge(nodeOptions, parsedConfig) as Partial<IBeaconNodeOptions>;
    }
    //override current config with cli config
    nodeOptions = deepmerge(nodeOptions, optionsToConfig(cmdOptions, BeaconNodeOptions));
    const peerId = await loadPeerIdFromJsonFile(cmdOptions.peerId);
    const defaultDiscv5Opt = {
      enr: ENR.createFromPeerId(peerId),
      bindAddr: "/ip4/127.0.0.1/udp/0",
      bootEnrs: [] as ENR[]};
    const discv5 = nodeOptions.network? Object.assign(defaultDiscv5Opt, nodeOptions.network.discv5) : defaultDiscv5Opt;
    const libp2pOpt = nodeOptions.network? Object.assign(nodeOptions.network, {discv5}) : {discv5};
    const libp2p = await createNodeJsLibp2p(peerId, libp2pOpt);
    const config = cmdOptions.preset === "minimal" ? minimalConfig : mainnetConfig;
    // nodejs will create EthersEth1Notifier by default
    if (cmdOptions.forkFile) {
      // @ts-ignore
      config.params.ALL_FORKS = load(fs.readFileSync(cmdOptions.forkFile));
    }
    this.node = new BeaconNode(nodeOptions, {config, logger, libp2p});
    await this.node.start();
    return this.node;
  }
}
