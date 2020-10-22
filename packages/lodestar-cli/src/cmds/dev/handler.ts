import fs from "fs";
import path from "path";
import {promisify} from "util";
import {initBLS} from "@chainsafe/bls";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {Validator} from "@chainsafe/lodestar-validator/lib";
import {initDevChain, storeSSZState} from "@chainsafe/lodestar/lib/node/utils/state";
import {createEnr, createPeerId} from "../../config";
import {IGlobalArgs} from "../../options";
import {mkdir} from "../../util";
import rimraf from "rimraf";
import {IDevArgs} from "./options";
import {getInteropValidator} from "../validator/utils/interop/validator";
import {getValidatorApiClient} from "./utils/validator";
import {onGracefulShutdown} from "../../util/process";
import {initializeOptionsAndConfig} from "../init/handler";
import {defaultRootDir} from "../../paths/global";

/**
 * Run a beacon node
 */
export async function devHandler(args: IDevArgs & IGlobalArgs): Promise<void> {
  await initBLS();

  const {beaconNodeOptions, config} = await initializeOptionsAndConfig(args);

  // ENR setup
  const peerId = await createPeerId();
  const enr = createEnr(peerId);
  beaconNodeOptions.set({network: {discv5: {enr}}});

  // Custom paths different than regular beacon, validator paths
  const rootDir = path.join(args.rootDir || defaultRootDir, "dev");
  const chainDir = path.join(rootDir, "beacon");
  const validatorsDir = path.join(rootDir, "validators");
  const dbPath = path.join(chainDir, "db-" + peerId.toB58String());
  const genesisStateFilePath = path.join(rootDir, "genesis.ssz");

  mkdir(chainDir);
  mkdir(validatorsDir);

  // TODO: Rename db.name to db.path or db.location
  beaconNodeOptions.set({db: {name: dbPath}});
  beaconNodeOptions.set({eth1: {enabled: false}});

  // BeaconNode setup
  const options = beaconNodeOptions.getWithDefaults();
  const libp2p = await createNodeJsLibp2p(peerId, options.network);
  const logger = new WinstonLogger();
  const node = new BeaconNode(options, {config, libp2p, logger});

  if (args.genesisValidators) {
    const state = await initDevChain(node, args.genesisValidators);
    storeSSZState(node.config, state, genesisStateFilePath);
  } else if (args.genesisStateFile) {
    await node.chain.initializeBeaconChain(
      config.types.BeaconState.tree.deserialize(await fs.promises.readFile(args.genesisStateFile))
    );
  }

  let validators: Validator[] = [];

  onGracefulShutdown(async () => {
    await Promise.all([Promise.all(validators.map((v) => v.stop())), node.stop()]);
    if (args.reset) {
      logger.info("Cleaning db directories");
      await promisify(rimraf)(chainDir);
      await promisify(rimraf)(validatorsDir);
    }
  }, logger.info.bind(logger));

  await node.start();

  if (args.startValidators) {
    const range = args.startValidators.split(":").map((s) => parseInt(s));
    const api = getValidatorApiClient(args.server, logger, node);
    validators = Array.from({length: range[1] + range[0]}, (v, i) => i + range[0]).map((index) => {
      return getInteropValidator(node.config, validatorsDir, {api, logger}, index);
    });
    validators.forEach((v) => v.start());
  }
}
