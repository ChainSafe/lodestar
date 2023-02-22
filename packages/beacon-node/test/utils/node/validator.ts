import tmp from "tmp";
import {LevelDbController} from "@lodestar/db";
import {interopSecretKey} from "@lodestar/state-transition";
import {SlashingProtection, Validator, Signer, SignerType, ValidatorProposerConfig} from "@lodestar/validator";
import type {SecretKey} from "@chainsafe/bls/types";
import {ServerApi, Api, HttpStatusCode, APIServerHandler} from "@lodestar/api";
import {mapValues} from "@lodestar/utils";
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
  doppelgangerProtectionEnabled = false,
  valProposerConfig,
}: {
  node: BeaconNode;
  validatorsPerClient: number;
  validatorClientCount: number;
  startIndex: number;
  useRestApi?: boolean;
  testLoggerOpts?: TestLoggerOpts;
  externalSignerUrl?: string;
  doppelgangerProtectionEnabled?: boolean;
  valProposerConfig?: ValidatorProposerConfig;
}): Promise<{validators: Validator[]; secretKeys: SecretKey[]}> {
  const validators: Promise<Validator>[] = [];
  const secretKeys: SecretKey[] = [];
  const abortController = new AbortController();

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
        api: useRestApi ? getNodeApiUrl(node) : getApiFromServerHandlers(node.api),
        slashingProtection,
        logger,
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        processShutdownCallback: () => {},
        abortController,
        signers,
        doppelgangerProtectionEnabled,
        valProposerConfig,
      })
    );
  }

  return {
    validators: await Promise.all(validators),
    // Return secretKeys to start the externalSigner
    secretKeys,
  };
}

export function getApiFromServerHandlers(api: {[K in keyof Api]: ServerApi<Api[K]>}): Api {
  return mapValues(api, (module) =>
    mapValues(module, (api: APIServerHandler) => {
      return async (...args: any) => {
        let code: HttpStatusCode = HttpStatusCode.OK;
        try {
          const response = await api(
            ...args,
            // request object
            {},
            // response object
            {
              code: (i: number) => {
                code = i;
              },
            }
          );
          return {response, ok: true, status: code};
        } catch (err) {
          return {
            ok: false,
            status: code ?? HttpStatusCode.INTERNAL_SERVER_ERROR,
            error: {
              code: code ?? HttpStatusCode.INTERNAL_SERVER_ERROR,
              message: (err as Error).message,
              operationId: `${module}.${api.name}`,
            },
          };
        }
      };
    })
  ) as Api;
}

export function getNodeApiUrl(node: BeaconNode): string {
  const address = node.opts.api.rest.address || "localhost";
  const port = node.opts.api.rest.port || 19596;
  return `http://${address}:${port}`;
}
