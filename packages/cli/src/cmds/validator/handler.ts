import {AbortController} from "@chainsafe/abort-controller";
import {getClient} from "@chainsafe/lodestar-api";
import {Validator, SlashingProtection, Signers, SignerType} from "@chainsafe/lodestar-validator";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {getBeaconConfigFromArgs} from "../../config";
import {IGlobalArgs} from "../../options";
import {YargsError, getDefaultGraffiti, initBLS, mkdir, getCliLogger} from "../../util";
import {onGracefulShutdown} from "../../util";
import {getBeaconPaths} from "../beacon/paths";
import {getValidatorPaths} from "./paths";
import {IValidatorCliArgs} from "./options";
import {getSecretKeys, getPublicKeys} from "./keys";
import {getVersion} from "../../util/version";
import {PublicKey, SecretKey} from "@chainsafe/bls";

/**
 * Runs a validator client.
 */
export async function validatorHandler(args: IValidatorCliArgs & IGlobalArgs): Promise<void> {
  await initBLS();

  const graffiti = args.graffiti || getDefaultGraffiti();

  const validatorPaths = getValidatorPaths(args);
  const beaconPaths = getBeaconPaths(args);
  const config = getBeaconConfigFromArgs(args);

  const logger = getCliLogger(args, beaconPaths, config);

  const version = getVersion();
  logger.info("Lodestar", {version: version, network: args.network});

  const {secretKeys, unlockSecretKeys: unlockSecretKeys} = await getSecretKeys(args);
  if (secretKeys.length === 0) {
    throw new YargsError("No validator keystores found");
  }

  // Log pubkeys for auditing
  logger.info(`Decrypted ${secretKeys.length} validator keystores`);
  for (const secretKey of secretKeys) {
    logger.info(secretKey.toPublicKey().toHex());
  }

  let signers: Signers;
  /** True is for remote mode, False is local mode */
  if (args.signingMode.toLowerCase() === "remote") {
    /** If remote mode chosen but no url provided */
    if (!args.signingUrl) {
      throw Error("Remote mode requires --url argument");
    }
    const pubkeys: PublicKey[] = await getPublicKeys(args);
    signers = {
      type: SignerType.Remote,
      url: args.signingUrl,
      pubkeys: pubkeys,
      secretKey: new SecretKey(),
    };
  } else if (args.signingMode.toLowerCase() === "local") {
    signers = {
      type: SignerType.Local,
      secretKeys: secretKeys,
    };
  } else {
    throw Error("Invalid mode. Only local and remote are supported");
  }

  const dbPath = validatorPaths.validatorsDbDir;
  mkdir(dbPath);

  const onGracefulShutdownCbs: (() => Promise<void>)[] = [];
  onGracefulShutdown(async () => {
    for (const cb of onGracefulShutdownCbs) await cb();
    unlockSecretKeys?.();
  }, logger.info.bind(logger));

  // This AbortController interrupts the sleep() calls when waiting for genesis
  const controller = new AbortController();
  onGracefulShutdownCbs.push(async () => controller.abort());

  const api = getClient(config, {baseUrl: args.server});
  const dbOps = {
    config: config,
    controller: new LevelDbController({name: dbPath}, {logger}),
  };
  const slashingProtection = new SlashingProtection(dbOps);

  const validator = await Validator.initializeFromBeaconNode(
    {dbOps, slashingProtection, api, logger, signers, graffiti},
    controller.signal
  );
  onGracefulShutdownCbs.push(async () => await validator.stop());
  await validator.start();
}
