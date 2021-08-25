import fs from "fs";
import {promisify} from "util";
import rimraf from "rimraf";
import path from "path";
import {AbortController} from "@chainsafe/abort-controller";
import {GENESIS_SLOT} from "@chainsafe/lodestar-params";
import {BeaconNode, BeaconDb, initStateFromAnchorState, createNodeJsLibp2p, nodeUtils} from "@chainsafe/lodestar";
import {SlashingProtection, Validator} from "@chainsafe/lodestar-validator";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {onGracefulShutdown} from "../../util/process";
import {createEnr, createPeerId} from "../../config";
import {IGlobalArgs} from "../../options";
import {IDevArgs} from "./options";
import {initializeOptionsAndConfig} from "../init/handler";
import {mkdir, initBLS, getCliLogger} from "../../util";
import {getBeaconPaths} from "../beacon/paths";
import {getValidatorPaths} from "../validator/paths";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {SecretKey} from "@chainsafe/bls";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {getVersion} from "../../util/version";

/**
 * Run a beacon node with validator
 */
export async function devHandler(args: IDevArgs & IGlobalArgs): Promise<void> {
  await initBLS();

  args.network = "dev";
  args.preset = "minimal";
  const {beaconNodeOptions, config} = await initializeOptionsAndConfig(args);

  // @TODO @Q9F The beacon node options are using mainnet, why???

  // ENR setup
  const peerId = await createPeerId();
  const enr = createEnr(peerId);
  beaconNodeOptions.set({network: {discv5: {enr}}});

  // DB setup
  const beaconPaths = getBeaconPaths(args);
  const validatorPaths = getValidatorPaths(args);
  const beaconDbDir = beaconPaths.dbDir;
  const validatorsDbDir = validatorPaths.validatorsDbDir;
  mkdir(beaconDbDir);
  mkdir(validatorsDbDir);

  // TODO: Rename db.name to db.path or db.location
  beaconNodeOptions.set({db: {name: beaconPaths.dbDir}});
  const options = beaconNodeOptions.getWithDefaults();

  // Genesis params
  const validatorCount = args.genesisValidators || 8;
  const genesisTime = args.genesisTime || Math.floor(Date.now() / 1000) + 5;
  // Set logger format to Eph with provided genesisTime
  if (args.logFormatGenesisTime === undefined) args.logFormatGenesisTime = genesisTime;

  // BeaconNode setup
  const libp2p = await createNodeJsLibp2p(peerId, options.network);
  const logger = getCliLogger(args, beaconPaths, config);
  logger.info("Lodestar", {version: getVersion(), network: args.network});

  const db = new BeaconDb({config, controller: new LevelDbController(options.db, {logger})});
  await db.start();

  let anchorState;
  if (args.genesisStateFile) {
    const state = config
      .getForkTypes(GENESIS_SLOT)
      .BeaconState.createTreeBackedFromBytes(await fs.promises.readFile(args.genesisStateFile));
    anchorState = await initStateFromAnchorState(config, db, logger, state);
  } else {
    anchorState = await initStateFromAnchorState(
      config,
      db,
      logger,
      await nodeUtils.initDevState(config, db, validatorCount, genesisTime)
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
    await Promise.all([Promise.all(validators.map((v) => v.stop())), node.close()]);
    if (args.reset) {
      logger.info("Cleaning db directories");
      await promisify(rimraf)(beaconDbDir);
      await promisify(rimraf)(validatorsDbDir);
    }
  }, logger.info.bind(logger));

  if (args.startValidators) {
    const secretKeys: SecretKey[] = [];
    const [fromIndex, toIndex] = args.startValidators.split(":").map((s) => parseInt(s));
    const valCount = anchorState.validators.length;
    const maxIndex = fromIndex + valCount - 1;

    if (fromIndex > toIndex) {
      throw Error(`Invalid startValidators arg '${args.startValidators}' - fromIndex > toIndex`);
    }

    if (toIndex > maxIndex) {
      throw Error(`Invalid startValidators arg '${args.startValidators}' - state has ${valCount} validators`);
    }

    for (let i = fromIndex; i <= toIndex; i++) {
      secretKeys.push(interopSecretKey(i));
    }

    const dbPath = path.join(validatorsDbDir, "validators");
    fs.mkdirSync(dbPath, {recursive: true});

    const api = args.server === "memory" ? node.api : args.server;
    const slashingProtection = new SlashingProtection({
      config: config,
      controller: new LevelDbController({name: dbPath}, {logger}),
    });

    const controller = new AbortController();
    onGracefulShutdownCbs.push(async () => controller.abort());

    // Initailize genesis once for all validators
    const validator = await Validator.initializeFromBeaconNode({
      config,
      slashingProtection,
      api,
      logger: logger.child({module: "vali"}),
      secretKeys,
    });

    onGracefulShutdownCbs.push(() => validator.stop());
    await validator.start();
  }
}
