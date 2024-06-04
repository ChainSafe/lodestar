import tmp from "tmp";
import type {SecretKey} from "@chainsafe/bls/types";
import {LevelDbController} from "@lodestar/db";
import {interopSecretKey} from "@lodestar/state-transition";
import {SlashingProtection, Validator, Signer, SignerType, ValidatorProposerConfig} from "@lodestar/validator";
import {ServerApi, Api, HttpStatusCode, APIServerHandler} from "@lodestar/api";
import {mapValues} from "@lodestar/utils";
import {BeaconNode} from "../../../src/index.js";
import {testLogger, TestLoggerOpts} from "../logger.js";

export async function getAndInitDevValidators({
  node,
  logPrefix,
  validatorsPerClient = 8,
  validatorClientCount = 1,
  startIndex = 0,
  useRestApi,
  testLoggerOpts,
  externalSignerUrl,
  doppelgangerProtection = false,
  valProposerConfig,
  useProduceBlockV3,
}: {
  node: BeaconNode;
  logPrefix: string;
  validatorsPerClient: number;
  validatorClientCount: number;
  startIndex: number;
  useRestApi?: boolean;
  testLoggerOpts?: TestLoggerOpts;
  externalSignerUrl?: string;
  doppelgangerProtection?: boolean;
  valProposerConfig?: ValidatorProposerConfig;
  useProduceBlockV3?: boolean;
}): Promise<{validators: Validator[]; secretKeys: SecretKey[]}> {
  const validators: Promise<Validator>[] = [];
  const secretKeys: SecretKey[] = [];
  const abortController = new AbortController();

  for (let clientIndex = 0; clientIndex < validatorClientCount; clientIndex++) {
    const startIndexVc = startIndex + clientIndex * validatorsPerClient;
    const endIndex = startIndexVc + validatorsPerClient - 1;
    const logger = testLogger(`${logPrefix}-VAL-${startIndexVc}-${endIndex}`, testLoggerOpts);
    const tmpDir = tmp.dirSync({unsafeCleanup: true});
    const db = await LevelDbController.create({name: tmpDir.name}, {logger});
    const slashingProtection = new SlashingProtection(db);

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
        db,
        config: node.config,
        api: useRestApi ? getNodeApiUrl(node) : getApiFromServerHandlers(node.api),
        slashingProtection,
        logger,
        processShutdownCallback: () => {},
        abortController,
        signers,
        doppelgangerProtection,
        valProposerConfig,
        useProduceBlockV3,
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
  return mapValues(api, (apiModule) =>
    mapValues(apiModule, (api: APIServerHandler) => {
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
              operationId: api.name,
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
