import {AbortController} from "@chainsafe/abort-controller";
import {getClient} from "@chainsafe/lodestar-api";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {getBeaconConfigFromArgs} from "../../config";
import {IGlobalArgs} from "../../options";
import {YargsError, getDefaultGraffiti, initBLS, mkdir, getCliLogger} from "../../util";
import {onGracefulShutdown} from "../../util";
import {getBeaconPaths} from "../beacon/paths";
import {getValidatorPaths} from "./paths";
import {IValidatorCliArgs} from "./options";
import {getLocalSecretKeys, getExternalSigners, groupExternalSignersByUrl} from "./keys";
import {getVersion} from "../../util/version";
import {SignerType, Signer, SlashingProtection, Validator} from "@chainsafe/lodestar-validator";
import {KeymanagerServer, KeymanagerApi, SecretKeyInfo} from "@chainsafe/lodestar-keymanager-server";

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

  const dbPath = validatorPaths.validatorsDbDir;
  mkdir(dbPath);

  const onGracefulShutdownCbs: (() => Promise<void> | void)[] = [];
  onGracefulShutdown(async () => {
    for (const cb of onGracefulShutdownCbs) await cb();
  }, logger.info.bind(logger));

  const signers: Signer[] = [];
  let secretKeysInfo: SecretKeyInfo[] = [];

  // Read remote keys
  // TODO [DA] why not check args.externalSignerPublicKeys.length?
  // this will prevent having to do some parsing to determine if externalSigners are provided
  const externalSigners = await getExternalSigners(args);
  if (externalSigners.length > 0) {
    logger.info(`Using ${externalSigners.length} external keys`);
    for (const {externalSignerUrl, pubkeyHex} of externalSigners) {
      signers.push({
        type: SignerType.Remote,
        pubkeyHex: pubkeyHex,
        externalSignerUrl,
      });
    }

    // Log pubkeys for auditing, grouped by signer URL
    for (const {externalSignerUrl, pubkeysHex} of groupExternalSignersByUrl(externalSigners)) {
      logger.info(`External signer URL: ${externalSignerUrl}`);
      for (const pubkeyHex of pubkeysHex) {
        logger.info(pubkeyHex);
      }
    }
  } else {
    // Read local keys
    secretKeysInfo = await getLocalSecretKeys(args);
    if (secretKeysInfo.length > 0) {
      // Log pubkeys for auditing
      logger.info(`Decrypted ${secretKeysInfo.length} local keystores`);
      for (const secretKeyInfo of secretKeysInfo) {
        logger.info(secretKeyInfo.secretKey.toPublicKey().toHex());
        signers.push({
          type: SignerType.Local,
          secretKey: secretKeyInfo.secretKey,
        });
      }

      // TODO [DA] revisit this
      onGracefulShutdownCbs.push(() => secretKeysInfo.pop()?.unlockSecretKeys?.());
    }
  }

  // Ensure the validator has at least one key

  if (signers.length === 0) {
    throw new YargsError("No signers found with current args");
  }

  // This AbortController interrupts the sleep() calls when waiting for genesis
  const controller = new AbortController();
  onGracefulShutdownCbs.push(async () => controller.abort());

  const api = getClient(config, {baseUrl: args.server});
  const dbOps = {
    config: config,
    controller: new LevelDbController({name: dbPath}, {logger}),
  };
  const slashingProtection = new SlashingProtection(dbOps);
  const importKeystoresPath = args.importKeystoresPath;
  const validator = await Validator.initializeFromBeaconNode(
    {dbOps, slashingProtection, api, logger, signers, secretKeysInfo, graffiti, importKeystoresPath},
    controller.signal
  );

  // Start keymanager API backend
  if (args.keymanagerEnabled) {
    const keymanagerApi = new KeymanagerApi(
      validator.validatorStore,
      slashingProtection,
      validator.genesis.genesisValidatorsRoot,
      importKeystoresPath,
      secretKeysInfo
    );

    const keymanagerServer = new KeymanagerServer(
      {host: args.keymanagerHost, port: args.keymanagerPort, cors: args.keymanagerCors},
      {config, logger, api: keymanagerApi}
    );
    await keymanagerServer.listen();
    onGracefulShutdownCbs.push(() => keymanagerServer.close());
  }

  onGracefulShutdownCbs.push(() => validator.stop());
  await validator.start();
}
