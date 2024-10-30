import {SecretKey} from "@chainsafe/blst";
import {ApiClient, ApiError, ApiResponse, HttpStatusCode} from "@lodestar/api";
import {BeaconApiMethods} from "@lodestar/api/beacon/server";
import {LevelDbController} from "@lodestar/db";
import {interopSecretKey} from "@lodestar/state-transition";
import {mapValues} from "@lodestar/utils";
import {Signer, SignerType, SlashingProtection, Validator, ValidatorProposerConfig} from "@lodestar/validator";
import tmp from "tmp";
import {vi} from "vitest";
import {BeaconNode} from "../../../src/index.js";
import {TestLoggerOpts, testLogger} from "../logger.js";

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
        api: {
          clientOrUrls: useRestApi ? getNodeApiUrl(node) : getApiFromServerHandlers(node.api),
        },
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

export function getApiFromServerHandlers(api: BeaconApiMethods): ApiClient {
  const apiClient = mapValues(api, (apiModule) =>
    mapValues(apiModule, (api: (args: unknown, context: unknown) => PromiseLike<{data: unknown; meta: unknown}>) => {
      return async (args: unknown) => {
        try {
          const apiResponse = new ApiResponse({} as any, null, new Response(null, {status: HttpStatusCode.OK}));
          const result = await api.call(apiModule, args, {});
          apiResponse.value = () => result.data;
          apiResponse.meta = () => result.meta;
          return apiResponse;
        } catch (err) {
          const apiResponse = new ApiResponse(
            {} as any,
            null,
            new Response(null, {status: HttpStatusCode.INTERNAL_SERVER_ERROR})
          );
          apiResponse.error = () => {
            return new ApiError((err as Error).message, HttpStatusCode.INTERNAL_SERVER_ERROR, api.name);
          };
          return apiResponse;
        }
      };
    })
  ) as ApiClient;

  apiClient.httpClient = {
    baseUrl: "",
    request: vi.fn(),
    urlsInits: [],
    urlsScore: [],
  };

  return apiClient;
}

export function getNodeApiUrl(node: BeaconNode): string {
  const address = node.opts.api.rest.address || "localhost";
  const port = node.opts.api.rest.port || 19596;
  return `http://${address}:${port}`;
}
