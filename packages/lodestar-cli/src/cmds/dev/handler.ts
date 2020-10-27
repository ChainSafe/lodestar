import fs, {mkdirSync} from "fs";
import {promisify} from "util";
import rimraf from "rimraf";
import {join} from "path";
import {initBLS} from "@chainsafe/bls";
import {IDiscv5DiscoveryInputOptions} from "@chainsafe/discv5";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {getInteropValidator} from "../validator/utils/interop/validator";
import {Validator} from "@chainsafe/lodestar-validator/lib";
import {initDevState, storeSSZState} from "@chainsafe/lodestar/lib/node/utils/state";
import {BeaconDb} from "@chainsafe/lodestar/lib/db";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {initStateFromAnchorState} from "@chainsafe/lodestar/lib/chain";
import {getValidatorApiClient} from "./utils/validator";
import {mergeConfigOptions} from "../../config/beacon";
import {getBeaconConfig} from "../../util";
import {getBeaconPaths} from "../beacon/paths";
import {onGracefulShutdown} from "../../util/process";
import {createEnr, createPeerId} from "../../network";
import {IGlobalArgs} from "../../options";
import {IDevArgs} from "./options";

/**
 * Run a beacon node
 */
export async function devHandler(options: IDevArgs & IGlobalArgs): Promise<void> {
  await initBLS();

  options = mergeConfigOptions(options);
  const peerId = await createPeerId();
  if (!options.network.discv5) options.network.discv5 = {} as IDiscv5DiscoveryInputOptions;
  options.network.discv5.enr = await createEnr(peerId);
  const beaconPaths = getBeaconPaths(options);
  options = {...options, ...beaconPaths};
  const config = getBeaconConfig(options.preset, options.params);
  const libp2p = await createNodeJsLibp2p(peerId, options.network);
  const logger = new WinstonLogger();

  const chainDir = join(options.rootDir, "dev", "beacon");
  const validatorsDir = join(options.rootDir, "dev", "validators");
  mkdirSync(chainDir, {recursive: true});
  mkdirSync(validatorsDir, {recursive: true});

  options.db.name = join(chainDir, "db-" + peerId.toB58String());
  options.eth1.enabled = false;

  const db = new BeaconDb({config, controller: new LevelDbController(options.db, {logger})});
  await db.start();

  let anchorState;
  if (options.genesisValidators) {
    anchorState = await initDevState(config, db, options.genesisValidators);
    storeSSZState(config, anchorState, join(options.rootDir, "dev", "genesis.ssz"));
  } else if (options.genesisStateFile) {
    anchorState = await initStateFromAnchorState(
      config,
      db,
      logger,
      config.types.BeaconState.tree.deserialize(
        await fs.promises.readFile(join(options.rootDir, options.genesisStateFile))
      )
    );
  } else {
    throw new Error("Unable to start node: no available genesis state");
  }

  let validators: Validator[] = [];

  const node = await BeaconNode.init({
    opts: options,
    config,
    db,
    logger,
    libp2p,
    anchorState,
  });

  onGracefulShutdown(async () => {
    await Promise.all([
      Promise.all(validators.map((v) => v.stop())),
      node.close(),
      async () => {
        if (options.reset) {
          logger.info("Cleaning db directories");
          await promisify(rimraf)(chainDir);
          await promisify(rimraf)(validatorsDir);
        }
      },
    ]);
  }, logger.info.bind(logger));

  if (options.startValidators) {
    const range = options.startValidators.split(":").map((s) => parseInt(s));
    const api = getValidatorApiClient(options.server, logger, node);
    validators = Array.from({length: range[1] + range[0]}, (v, i) => i + range[0]).map((index) => {
      return getInteropValidator(
        node.config,
        validatorsDir,
        {
          api,
          logger,
        },
        index
      );
    });
    validators.forEach((v) => v.start());
  }
}
