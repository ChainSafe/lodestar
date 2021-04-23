import tmp from "tmp";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {ILogger, LogLevel} from "@chainsafe/lodestar-utils";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {IApiClient, SlashingProtection, Validator} from "@chainsafe/lodestar-validator";
import {Eth1ForBlockProductionDisabled} from "../../../src/eth1";
import {BeaconNode} from "../../../src/node";
import {testLogger, TestLoggerOpts} from "../logger";
import {Api} from "../../../src/api";

export function getDevValidators({
  node,
  validatorsPerClient = 8,
  validatorClientCount = 1,
  startIndex = 0,
  useRestApi,
  testLoggerOpts,
}: {
  node: BeaconNode;
  validatorsPerClient: number;
  validatorClientCount: number;
  startIndex: number;
  useRestApi?: boolean;
  testLoggerOpts?: TestLoggerOpts;
}): Validator[] {
  const vcs: Validator[] = [];
  for (let i = 0; i < validatorClientCount; i++) {
    const startIndexVc = startIndex + i * validatorClientCount;
    const endIndex = startIndexVc + validatorsPerClient - 1;
    const logger = testLogger(`Vali ${startIndexVc}-${endIndex}`, testLoggerOpts);

    const tmpDir = tmp.dirSync({unsafeCleanup: true});

    vcs.push(
      new Validator({
        config: node.config,
        api: useRestApi ? getNodeApiUrl(node) : getApiInstance(node, logger),
        slashingProtection: new SlashingProtection({
          config: node.config,
          controller: new LevelDbController({name: tmpDir.name}, {logger}),
        }),
        logger,
        secretKeys: Array.from({length: validatorsPerClient}, (_, i) => interopSecretKey(i + startIndexVc)),
      })
    );
  }

  return vcs;
}

function getNodeApiUrl(node: BeaconNode): string {
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
