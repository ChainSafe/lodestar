import tmp, {DirResult, FileResult} from "tmp";
import fs from "node:fs";
import path from "node:path";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {
  SlashingProtection,
  Validator,
  Signer,
  SignerType,
  ISlashingProtection,
  SignerLocal,
} from "@chainsafe/lodestar-validator";
import {BeaconNode} from "../../../src/node/index.js";
import {testLogger, TestLoggerOpts} from "../logger.js";
import type {SecretKey} from "@chainsafe/bls/types";
import {getLocalSecretKeys} from "../../../../cli/src/cmds/validator/keys.js";
import {IValidatorCliArgs} from "../../../../cli/src/cmds/validator/options.js";
import {IGlobalArgs} from "../../../../cli/src/options/index.js";
import {KEY_IMPORTED_PREFIX} from "@chainsafe/lodestar-keymanager-server";

export async function getAndInitValidatorsWithKeystore({
  node,
  keystoreContent,
  keystorePubKey,
  useRestApi,
  testLoggerOpts,
}: {
  node: BeaconNode;
  keystoreContent: string;
  keystorePubKey: string;
  useRestApi?: boolean;
  testLoggerOpts?: TestLoggerOpts;
}): Promise<{
  validator: Validator;
  secretKeys: SecretKey[];
  keystoreContent: string;
  signers: SignerLocal[];
  slashingProtection: ISlashingProtection;
  tempDirs: {
    keystoreDir: DirResult;
    passwordFile: FileResult;
  };
}> {
  const keystoreDir = tmp.dirSync({unsafeCleanup: true});
  const keystoreFile = path.join(`${keystoreDir.name}`, `${KEY_IMPORTED_PREFIX}_${keystorePubKey}.json`);

  fs.writeFileSync(keystoreFile, keystoreContent, {encoding: "utf8", flag: "wx"});

  const passwordFile = tmp.fileSync();
  fs.writeFileSync(passwordFile.name, "test123!", {encoding: "utf8"});

  const vcConfig = {
    network: "prater",
    importKeystoresPath: [`${keystoreDir.name}`],
    importKeystoresPassword: `${passwordFile.name}`,
    keymanagerEnabled: true,
    keymanagerAuthEnabled: true,
    keymanagerHost: "127.0.0.1",
    keymanagerPort: 9666,
    keymanagerCors: "*",
  };

  const logger = testLogger("Vali", testLoggerOpts);
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  const dbOps = {
    config: node.config,
    controller: new LevelDbController({name: tmpDir.name}, {logger}),
  };
  const slashingProtection = new SlashingProtection(dbOps);

  const signers: SignerLocal[] = [];

  const {secretKeys, unlockSecretKeys: _unlockSecretKeys} = await getLocalSecretKeys(
    (vcConfig as unknown) as IValidatorCliArgs & IGlobalArgs
  );
  if (secretKeys.length > 0) {
    // Log pubkeys for auditing
    logger.info(`Decrypted ${secretKeys.length} local keystores`);
    for (const secretKey of secretKeys) {
      logger.info(secretKey.toPublicKey().toHex());
      signers.push({
        type: SignerType.Local,
        secretKey,
      });
    }
  }

  const validator = await Validator.initializeFromBeaconNode({
    dbOps,
    api: useRestApi ? getNodeApiUrl(node) : node.api,
    slashingProtection,
    logger,
    signers,
  });

  return {
    validator,
    secretKeys,
    keystoreContent,
    signers,
    slashingProtection,
    tempDirs: {
      keystoreDir: keystoreDir,
      passwordFile: passwordFile,
    },
  };
}

export async function getAndInitDevValidators({
  node,
  validatorsPerClient = 8,
  validatorClientCount = 1,
  startIndex = 0,
  useRestApi,
  testLoggerOpts,
  externalSignerUrl,
  defaultFeeRecipient,
}: {
  node: BeaconNode;
  validatorsPerClient: number;
  validatorClientCount: number;
  startIndex: number;
  useRestApi?: boolean;
  testLoggerOpts?: TestLoggerOpts;
  externalSignerUrl?: string;
  defaultFeeRecipient?: string;
}): Promise<{validators: Validator[]; secretKeys: SecretKey[]}> {
  const validators: Promise<Validator>[] = [];
  const secretKeys: SecretKey[] = [];

  for (let clientIndex = 0; clientIndex < validatorClientCount; clientIndex++) {
    const startIndexVc = startIndex + clientIndex * validatorsPerClient;
    const endIndex = startIndexVc + validatorsPerClient - 1;
    const logger = testLogger(`Vali ${startIndexVc}-${endIndex}`, testLoggerOpts);
    const tmpDir = tmp.dirSync({unsafeCleanup: true});
    const dbOps = {
      config: node.config,
      controller: new LevelDbController({name: tmpDir.name}, {logger}),
    };
    const slashingProtection = new SlashingProtection(dbOps);

    const secretKeysValidator = Array.from({length: validatorsPerClient}, (_, i) => interopSecretKey(i + startIndexVc));
    secretKeys.push(...secretKeysValidator);

    const signers = externalSignerUrl
      ? secretKeysValidator.map(
          (secretKey): Signer => ({
            type: SignerType.Remote,
            externalSignerUrl,
            pubkeyHex: secretKey.toPublicKey().toHex(),
          })
        )
      : secretKeysValidator.map(
          (secretKey): Signer => ({
            type: SignerType.Local,
            secretKey,
          })
        );

    validators.push(
      Validator.initializeFromBeaconNode({
        dbOps,
        api: useRestApi ? getNodeApiUrl(node) : node.api,
        slashingProtection,
        logger,
        signers,
        defaultFeeRecipient,
      })
    );
  }

  return {
    validators: await Promise.all(validators),
    // Return secretKeys to start the externalSigner
    secretKeys,
  };
}

function getNodeApiUrl(node: BeaconNode): string {
  const host = node.opts.api.rest.host || "127.0.0.1";
  const port = node.opts.api.rest.port || 19596;
  return `http://${host}:${port}`;
}
