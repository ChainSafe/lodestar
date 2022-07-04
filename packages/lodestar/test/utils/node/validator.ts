import tmp from "tmp";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {SlashingProtection, Validator, Signer, SignerType} from "@chainsafe/lodestar-validator";
import type {SecretKey} from "@chainsafe/bls/types";
import {BeaconNode} from "../../../src/index.js";
import {testLogger, TestLoggerOpts} from "../logger.js";

export async function getAndInitDevValidators({
  node,
  validatorsPerClient = 8,
  validatorClientCount = 1,
  startIndex = 0,
  useRestApi,
  testLoggerOpts,
  externalSignerUrl,
  defaultFeeRecipient,
  doppelgangerProtectionEnabled = false,
  builder = {},
}: {
  node: BeaconNode;
  validatorsPerClient: number;
  validatorClientCount: number;
  startIndex: number;
  useRestApi?: boolean;
  testLoggerOpts?: TestLoggerOpts;
  externalSignerUrl?: string;
  defaultFeeRecipient?: string;
  doppelgangerProtectionEnabled?: boolean;
  builder?: {enabled?: boolean};
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
            url: externalSignerUrl,
            pubkey: secretKey.toPublicKey().toHex(),
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
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        processShutdownCallback: () => {},
        signers,
        defaultFeeRecipient,
        doppelgangerProtectionEnabled,
        builder,
      })
    );
  }

  return {
    validators: await Promise.all(validators),
    // Return secretKeys to start the externalSigner
    secretKeys,
  };
}

export function getNodeApiUrl(node: BeaconNode): string {
  const address = node.opts.api.rest.address || "127.0.0.1";
  const port = node.opts.api.rest.port || 19596;
  return `http://${address}:${port}`;
}
