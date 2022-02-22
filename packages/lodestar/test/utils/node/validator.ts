import tmp, {DirResult, FileResult} from "tmp";
import fs from "node:fs";
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
import {BeaconNode} from "../../../src/node";
import {testLogger, TestLoggerOpts} from "../logger";
import {SecretKey} from "@chainsafe/bls";
import {getLocalSecretKeys} from "@chainsafe/lodestar-cli/src/cmds/validator/keys";
import {IValidatorCliArgs} from "@chainsafe/lodestar-cli/src/cmds/validator/options";
import {IGlobalArgs} from "@chainsafe/lodestar-cli/src/options";
import {KEY_IMPORTED_PREFIX} from "@chainsafe/lodestar-keymanager-server/src";

export function getKeystoreForPubKey1(): string {
  return JSON.stringify({
    crypto: {
      kdf: {
        function: "scrypt",
        params: {
          dklen: 32,
          n: 262144,
          r: 8,
          p: 1,
          salt: "87f8e61bd461206ebbb222f2e789322504b6543067a8b49f2c29f35f203a56c5",
        },
        message: "",
      },
      checksum: {
        function: "sha256",
        params: {},
        message: "e3b7f6a0dc99543fa62afd4bcdf2a49b4ee8075609389eaa0bfeeb8987fcf8b8",
      },
      cipher: {
        function: "aes-128-ctr",
        params: {
          iv: "84008836292fbc9bd9efb50d95939cdc",
        },
        message: "b81e6288a4307b8e29f2e952cecc5642e0832ae7123b93306702ec48cdf2f8d9",
      },
    },
    description: "",
    pubkey: "97b1b00d3c1888b5715c2c88bf1df7b0ad715388079de211bdc153697b69b868c671af3b2d86c5cdfbade48d03888ab4",
    path: "m/12381/3600/0/0/0",
    uuid: "537500a4-37ae-48f3-8ac2-2deda5285699",
    version: 4,
  }).trim();
}

export function getKeystoreForPubKey2(): string {
  return JSON.stringify({
    crypto: {
      kdf: {
        function: "scrypt",
        params: {
          dklen: 32,
          n: 262144,
          r: 8,
          p: 1,
          salt: "6e179aeba4e5ac240b326cafe9a5de4ed7c17ac956b3c06537b384a508f5a818",
        },
        message: "",
      },
      checksum: {
        function: "sha256",
        params: {},
        message: "5436d7e035b60c08f9b285a5251ee5f5e2275e44ed161cba4352f1c1da869697",
      },
      cipher: {
        function: "aes-128-ctr",
        params: {
          iv: "7e87e2c3ede5e95aa86df569934b5e5c",
        },
        message: "c06ebc0a02c61be5dafbe59e3d286e762f3b9fe0505176bd5504ed49ef90373a",
      },
    },
    description: "",
    pubkey: "a74e11fd129b9bafc2d6afad4944cd289c238139130a7abafe7b28dde1923a0e4833ad776f9e0d7aaaecd9f0acbfedd3",
    path: "m/12381/3600/0/0/0",
    uuid: "5c0169d3-c132-4581-8e7c-afcbf45000cf",
    version: 4,
  }).trim();
}

export async function getAndInitValidatorsWithKeystoreOne({
  node,
  keystorePubKey,
  keystoreContent,
  useRestApi,
  testLoggerOpts,
}: {
  node: BeaconNode;
  keystorePubKey: string;
  keystoreContent: string;
  validatorsPerClient: number;
  validatorClientCount: number;
  useRestApi?: boolean;
  testLoggerOpts?: TestLoggerOpts;
}): Promise<{
  validator: Validator;
  secretKeys: SecretKey[];
  signers: SignerLocal[];
  slashingProtection: ISlashingProtection;
  keystoreContent: string;
  tempDirs: {
    keystoreDir: DirResult;
    passwordFile: FileResult;
  };
}> {
  return getAndInitValidatorsWithKeystore({
    node,
    keystoreContent,
    keystorePubKey,
    useRestApi,
    testLoggerOpts,
  });
}

export async function getAndInitValidatorsWithKeystoreTwo({
  node,
  keystorePubKey,
  useRestApi,
  testLoggerOpts,
}: {
  node: BeaconNode;
  keystorePubKey: string;
  validatorsPerClient: number;
  validatorClientCount: number;
  useRestApi?: boolean;
  testLoggerOpts?: TestLoggerOpts;
}): Promise<{
  validator: Validator;
  secretKeys: SecretKey[];
  signers: SignerLocal[];
  slashingProtection: ISlashingProtection;
  tempDirs: {
    keystoreDir: DirResult;
    passwordFile: FileResult;
  };
}> {
  return getAndInitValidatorsWithKeystore({
    node,
    keystoreContent: getKeystoreForPubKey2(),
    keystorePubKey,
    useRestApi,
    testLoggerOpts,
  });
}

async function getAndInitValidatorsWithKeystore({
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
  const keystoreFile = `${keystoreDir.name}/${KEY_IMPORTED_PREFIX}_${keystorePubKey}.json`;

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
}: {
  node: BeaconNode;
  validatorsPerClient: number;
  validatorClientCount: number;
  startIndex: number;
  useRestApi?: boolean;
  testLoggerOpts?: TestLoggerOpts;
  externalSignerUrl?: string;
}): Promise<{validators: Validator[]; secretKeys: SecretKey[]; keymanagerOps?: Record<string, ISlashingProtection>}> {
  const validators: Promise<Validator>[] = [];
  const secretKeys: SecretKey[] = [];
  const keymanagerOps: Record<string, ISlashingProtection> = {};

  for (let i = 0; i < validatorClientCount; i++) {
    const startIndexVc = startIndex + i * validatorClientCount;
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
      })
    );

    keymanagerOps[i] = slashingProtection;
  }

  return {
    validators: await Promise.all(validators),
    // Return secretKeys to start the externalSigner
    secretKeys,
    keymanagerOps,
  };
}

function getNodeApiUrl(node: BeaconNode): string {
  const host = node.opts.api.rest.host || "127.0.0.1";
  const port = node.opts.api.rest.port || 9596;
  return `http://${host}:${port}`;
}
