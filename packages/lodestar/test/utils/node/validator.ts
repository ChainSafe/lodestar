import {LevelDbController} from "@chainsafe/lodestar-db";
import {ILogger, LogLevel, interopSecretKey} from "@chainsafe/lodestar-utils";
import {IEventsApi} from "@chainsafe/lodestar-validator/lib/api/interface/events";
import {
  ApiClientOverInstance,
  ApiClientOverRest,
  IApiClient,
  SlashingProtection,
  Validator,
} from "@chainsafe/lodestar-validator";
import tmp from "tmp";
import {BeaconApi} from "../../../src/api/impl/beacon";
import {EventsApi} from "../../../src/api/impl/events";
import {NodeApi} from "../../../src/api/impl/node/node";
import {ValidatorApi} from "../../../src/api/impl/validator";
import {Eth1ForBlockProductionDisabled} from "../../../src/eth1";
import {BeaconNode} from "../../../src/node";
import {ConfigApi} from "../../../src/api/impl/config";
import {testLogger} from "../logger";

export function getDevValidators({
  node,
  count = 8,
  validatorClientCount = 1,
  useRestApi,
  logger,
}: {
  node: BeaconNode;
  count: number;
  validatorClientCount: number;
  useRestApi?: boolean;
  logger?: ILogger;
}): Validator[] {
  const vcs: Validator[] = [];
  for (let i = 0; i < count; i++) {
    vcs.push(
      getDevValidator({
        node,
        startIndex: i * validatorClientCount,
        count: validatorClientCount,
        useRestApi,
        logger,
      })
    );
  }
  return vcs;
}

export function getDevValidator({
  node,
  startIndex,
  count,
  logger,
  useRestApi = false,
}: {
  node: BeaconNode;
  startIndex: number;
  count: number;
  logger?: ILogger;
  useRestApi?: boolean;
}): Validator {
  if (!logger) logger = testLogger(`validator-${startIndex}`);
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  return new Validator({
    config: node.config,
    api: useRestApi ? getDevValidatorRestApiClient(node, logger) : getDevValidatorInstanceApiClient(node, logger),
    slashingProtection: new SlashingProtection({
      config: node.config,
      controller: new LevelDbController({name: tmpDir.name}, {logger}),
    }),
    logger,
    secretKeys: Array.from({length: count}, (_, i) => interopSecretKey(i + startIndex)),
  });
}

export function getDevValidatorRestApiClient(node: BeaconNode, logger: ILogger): IApiClient {
  return new ApiClientOverRest(
    node.config,
    "http://127.0.0.1:9596",
    logger.child({module: "api", level: LogLevel.warn})
  );
}

export function getDevValidatorInstanceApiClient(node: BeaconNode, parentLogger: ILogger): IApiClient {
  const logger = parentLogger.child({module: "api", level: LogLevel.warn});
  return new ApiClientOverInstance({
    config: node.config,
    validator: new ValidatorApi({}, {...node, logger, eth1: new Eth1ForBlockProductionDisabled()}),
    node: new NodeApi({}, {...node}),
    events: new EventsApi({}, {...node}) as IEventsApi,
    beacon: new BeaconApi({}, {...node}),
    configApi: new ConfigApi({}, {config: node.config}),
    logger,
  });
}
