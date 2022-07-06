import fs from "node:fs";
import {promisify} from "node:util";
import path from "node:path";
import rimraf from "rimraf";
import {fromHexString} from "@chainsafe/ssz";
import {GENESIS_SLOT} from "@lodestar/params";
import {BeaconNode, BeaconDb, initStateFromAnchorState, createNodeJsLibp2p, nodeUtils} from "@lodestar/beacon-node";
import {SlashingProtection, Validator, SignerType} from "@lodestar/validator";
import {LevelDbController} from "@lodestar/db";
import {interopSecretKey} from "@lodestar/state-transition";
import {createIBeaconConfig} from "@lodestar/config";
import {ACTIVE_PRESET, PresetName} from "@lodestar/params";
import {onGracefulShutdown} from "../../util/process.js";
import {createEnr, createPeerId, overwriteEnrWithCliArgs} from "../../config/index.js";
import {IGlobalArgs, parseEnrArgs} from "../../options/index.js";
import {initializeOptionsAndConfig} from "../init/handler.js";
import {mkdir, getCliLogger, parseRange} from "../../util/index.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {getValidatorPaths} from "../validator/paths.js";
import {getVersionData} from "../../util/version.js";
import {IDevArgs} from "./options.js";

/**
 * Run a beacon node with validator
 */
export async function devHandler(args: IDevArgs & IGlobalArgs): Promise<void> {
  const {beaconNodeOptions, config} = await initializeOptionsAndConfig(args);

  // ENR setup
  const peerId = await createPeerId();
  const enr = createEnr(peerId);
  beaconNodeOptions.set({network: {discv5: {enr}}});
  const enrArgs = parseEnrArgs(args);
  overwriteEnrWithCliArgs(enr, enrArgs, beaconNodeOptions.getWithDefaults());

  // Note: defaults to network "dev", to all paths are custom and don't conflict with networks.
  // Flag --reset cleans up the custom dirs on dev stop
  const beaconPaths = getBeaconPaths(args);
  const validatorPaths = getValidatorPaths(args);
  const beaconDbDir = beaconPaths.dbDir;
  const validatorsDbDir = validatorPaths.validatorsDbDir;

  // Remove slashing protection db. Otherwise the validators won't be able to propose nor attest
  // until the clock reach a higher slot than the previous run of the dev command
  if (args.genesisTime === undefined) {
    await promisify(rimraf)(beaconDbDir);
    await promisify(rimraf)(validatorsDbDir);
  }

  mkdir(beaconDbDir);
  mkdir(validatorsDbDir);

  // TODO: Rename db.name to db.path or db.location
  beaconNodeOptions.set({db: {name: beaconPaths.dbDir}});
  const options = beaconNodeOptions.getWithDefaults();

  // Genesis params
  const validatorCount = args.genesisValidators ?? 8;
  const genesisTime = args.genesisTime ?? Math.floor(Date.now() / 1000) + 5;
  // Set logger format to Eph with provided genesisTime
  if (args.logFormatGenesisTime === undefined) args.logFormatGenesisTime = genesisTime;

  // BeaconNode setup
  const libp2p = await createNodeJsLibp2p(peerId, options.network, {peerStoreDir: beaconPaths.peerStoreDir});
  const logger = getCliLogger(args, beaconPaths, config);
  logger.info("Lodestar", {network: args.network, ...getVersionData()});
  if (ACTIVE_PRESET === PresetName.minimal) logger.info("ACTIVE_PRESET == minimal preset");

  const db = new BeaconDb({config, controller: new LevelDbController(options.db, {logger})});
  await db.start();

  let anchorState;
  if (args.genesisStateFile) {
    const state = config
      .getForkTypes(GENESIS_SLOT)
      .BeaconState.deserializeToViewDU(await fs.promises.readFile(args.genesisStateFile));
    anchorState = await initStateFromAnchorState(config, db, logger, state);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const eth1BlockHash = args.genesisEth1Hash ? fromHexString(args.genesisEth1Hash!) : undefined;
    anchorState = await initStateFromAnchorState(
      config,
      db,
      logger,
      await nodeUtils.initDevState(config, db, validatorCount, {genesisTime, eth1BlockHash})
    );
  }
  const beaconConfig = createIBeaconConfig(config, anchorState.genesisValidatorsRoot);

  const validators: Validator[] = [];

  const node = await BeaconNode.init({
    opts: options,
    config: beaconConfig,
    db,
    logger,
    libp2p,
    anchorState,
  });

  const onGracefulShutdownCbs: (() => Promise<void>)[] = [];
  onGracefulShutdown(async () => {
    for (const cb of onGracefulShutdownCbs) await cb();
    await Promise.all([Promise.all(validators.map((v) => v.close())), node.close()]);
    if (args.reset) {
      logger.info("Cleaning db directories");
      await promisify(rimraf)(beaconDbDir);
      await promisify(rimraf)(validatorsDbDir);
    }
  }, logger.info.bind(logger));

  if (args.startValidators) {
    const indexes = parseRange(args.startValidators);
    const secretKeys = indexes.map((i) => interopSecretKey(i));

    const dbPath = path.join(validatorsDbDir, "validators");
    fs.mkdirSync(dbPath, {recursive: true});

    const api = args.server === "memory" ? node.api : args.server;
    const dbOps = {
      config: config,
      controller: new LevelDbController({name: dbPath}, {logger}),
    };
    const slashingProtection = new SlashingProtection(dbOps);

    const controller = new AbortController();
    onGracefulShutdownCbs.push(async () => controller.abort());

    // Initailize genesis once for all validators
    const validator = await Validator.initializeFromBeaconNode({
      dbOps,
      slashingProtection,
      api,
      logger: logger.child({module: "vali"}),
      // TODO: De-duplicate from validator cmd handler
      processShutdownCallback: () => process.kill(process.pid, "SIGINT"),
      signers: secretKeys.map((secretKey) => ({
        type: SignerType.Local,
        secretKey,
      })),
      doppelgangerProtectionEnabled: args.doppelgangerProtectionEnabled,
      builder: {},
    });

    onGracefulShutdownCbs.push(() => validator.close());
  }
}
