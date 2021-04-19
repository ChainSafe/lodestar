import {LevelDbController} from "@chainsafe/lodestar-db";
import {ILogger, LogLevel} from "@chainsafe/lodestar-utils";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {IApiClient, SlashingProtection, Validator} from "@chainsafe/lodestar-validator";
import tmp from "tmp";
import {Eth1ForBlockProductionDisabled} from "../../../src/eth1";
import {BeaconNode} from "../../../src/node";
import {testLogger} from "../logger";
import {Api} from "../../../src/api";

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
    api: useRestApi ? getNodeApiUrl(node) : getApiInstance(node, logger),
    slashingProtection: new SlashingProtection({
      config: node.config,
      controller: new LevelDbController({name: tmpDir.name}, {logger}),
    }),
    logger,
    secretKeys: Array.from({length: count}, (_, i) => interopSecretKey(i + startIndex)),
  });
}

export function getNodeApiUrl(node: BeaconNode): string {
  const host = node.opts.api.rest.host || "127.0.0.1";
  const port = node.opts.api.rest.port || 9596;
  return `http://${host}:${port}`;
}

export function getApiInstance(node: BeaconNode, parentLogger: ILogger): IApiClient {
  return new Api(
    {},
    {
      ...node,
      logger: parentLogger.child({module: "api", level: LogLevel.warn}),
      eth1: new Eth1ForBlockProductionDisabled(),
    }
    // TODO: Review why this casting is necessary
  ) as IApiClient;
}
