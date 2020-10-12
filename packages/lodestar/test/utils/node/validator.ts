import {BeaconNode} from "../../../src/node";
import {ValidatorDB} from "@chainsafe/lodestar-validator/lib/db";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {ApiClientOverInstance, interopKeypair, Validator} from "@chainsafe/lodestar-validator/lib";
import {intDiv, LogLevel, WinstonLogger, ILogger} from "@chainsafe/lodestar-utils";
import tmp from "tmp";
import {ValidatorApi} from "../../../src/api/impl/validator";
import {BeaconApi} from "../../../src/api/impl/beacon";
import {NodeApi} from "../../../src/api/impl/node/node";
import {Eth1ForBlockProductionDisabled} from "../../../src/eth1";
import {EventsApi} from "../../../src/api/impl/events";
import {IEventsApi} from "@chainsafe/lodestar-validator/lib/api/interface/events";

export function getDevValidators(node: BeaconNode, count = 8, validatorClientCount = 1): Validator[] {
  const validatorsPerValidatorClient = intDiv(count, validatorClientCount);
  const vcs: Validator[] = [];
  while (count > 0) {
    if (count > validatorsPerValidatorClient) {
      vcs.push(
        getDevValidator({
          node,
          startIndex: vcs.length * validatorsPerValidatorClient,
          count: validatorsPerValidatorClient,
        })
      );
    } else {
      vcs.push(
        getDevValidator({
          node,
          startIndex: vcs.length * validatorsPerValidatorClient,
          count,
        })
      );
    }
    count = count - validatorsPerValidatorClient;
  }
  return vcs;
}

export function getDevValidator({
  node,
  startIndex,
  count,
  logger,
}: {
  node: BeaconNode;
  startIndex: number;
  count: number;
  logger?: ILogger;
}): Validator {
  if (!logger) logger = new WinstonLogger({level: LogLevel.debug, module: "validator"});
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  return new Validator({
    config: node.config,
    db: new ValidatorDB({
      config: node.config,
      controller: new LevelDbController(
        {
          name: tmpDir.name,
        },
        {logger}
      ),
    }),
    api: new ApiClientOverInstance({
      config: node.config,
      validator: new ValidatorApi(
        {},
        {
          ...node,
          logger,
          eth1: new Eth1ForBlockProductionDisabled(),
        }
      ),
      node: new NodeApi({}, {...node}),
      events: new EventsApi({}, {...node}) as IEventsApi,
      beacon: new BeaconApi({}, {...node}),
    }),
    logger: logger,
    keypairs: Array.from({length: count}, (_, i) => {
      return new Keypair(PrivateKey.fromBytes(interopKeypair(i + startIndex).privkey));
    }),
  });
}
