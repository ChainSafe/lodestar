import fs from "fs";
import path from "path";
import {promisify} from "util";
import rimraf from "rimraf";
import {join} from "path";
import {BeaconNode, BeaconDb, initStateFromAnchorState, createNodeJsLibp2p, nodeUtils} from "@chainsafe/lodestar";
import {Logger} from "@chainsafe/lodestar-utils";
import {Validator} from "@chainsafe/lodestar-validator";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {getInteropValidator} from "../validator/utils/interop/validator";
import {getValidatorApiClient} from "./utils/validator";
import {onGracefulShutdown} from "../../util/process";
import {createEnr, createPeerId} from "../../config";
import {IGlobalArgs} from "../../options";
import {IDevArgs} from "./options";
import {initializeOptionsAndConfig} from "../init/handler";
import {mkdir, initBLS} from "../../util";

/**
 * Run a beacon node with validator
 */
export async function devHandler(args: IDevArgs & IGlobalArgs): Promise<void> {
  await initBLS();

  const {beaconNodeOptions, config} = await initializeOptionsAndConfig(args);

  // ENR setup
  const peerId = await createPeerId();
  const enr = createEnr(peerId);
  beaconNodeOptions.set({network: {discv5: {enr}}});

  // Custom paths different than regular beacon, validator paths
  const rootDir = path.join(args.rootDir || "./.lodestar", "dev");
  const chainDir = path.join(rootDir, "beacon");
  const validatorsDir = path.join(rootDir, "validators");
  const dbPath = path.join(chainDir, "db-" + peerId.toB58String());

  mkdir(chainDir);
  mkdir(validatorsDir);

  // TODO: Rename db.name to db.path or db.location
  beaconNodeOptions.set({db: {name: dbPath}});
  const options = beaconNodeOptions.getWithDefaults();

  // BeaconNode setup
  const libp2p = await createNodeJsLibp2p(peerId, options.network);
  const logger = new Logger({level: args.logLevel});

  const db = new BeaconDb({config, controller: new LevelDbController(options.db, {logger})});
  await db.start();

  let anchorState;
  if (args.genesisValidators) {
    anchorState = await nodeUtils.initDevState(config, db, args.genesisValidators);
    nodeUtils.storeSSZState(config, anchorState, join(args.rootDir, "dev", "genesis.ssz"));
  } else if (args.genesisStateFile) {
    anchorState = await initStateFromAnchorState(
      config,
      db,
      logger,
      config.types.phase0.BeaconState.tree.deserialize(
        await fs.promises.readFile(join(args.rootDir, args.genesisStateFile))
      )
    );
  } else {
    throw new Error("Unable to start node: no available genesis state");
  }

  const validators: Validator[] = [];

  const node = await BeaconNode.init({
    opts: options,
    config,
    db,
    logger,
    libp2p,
    anchorState,
  });

  onGracefulShutdown(async () => {
    await Promise.all([Promise.all(validators.map((v) => v.stop())), node.close()]);
    if (args.reset) {
      logger.info("Cleaning db directories");
      await promisify(rimraf)(chainDir);
      await promisify(rimraf)(validatorsDir);
    }
  }, logger.info.bind(logger));

  if (args.startValidators) {
    const [fromIndex, toIndex] = args.startValidators!.split(":").map((s) => parseInt(s));
    const api = getValidatorApiClient(args.server, logger, node);
    for (let i = fromIndex; i < toIndex; i++) {
      validators.push(getInteropValidator(node.config, validatorsDir, {api, logger}, i));
    }
    await Promise.all(validators.map((validator) => validator.start()));
  }
}
