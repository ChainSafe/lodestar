import {BeaconNode} from "../../../src/node";
import {ValidatorDB} from "../../../src/db/api";
import {LevelDbController} from "../../../src/db/controller";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {ApiClientOverInstance, interopKeypair, Validator} from "@chainsafe/lodestar-validator/lib";
import {intDiv, LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils";
import tmp from "tmp";
import {ValidatorApi} from "../../../src/api/impl/validator";
import {BeaconApi} from "../../../src/api/impl/beacon";
import {NodeApi} from "../../../src/api/impl/node/node";
import {toHexString} from "@chainsafe/ssz";

export function getDevValidators(node: BeaconNode, count = 8, validatorClientCount = 1): Validator[] {
  const validatorsPerValidatorClient = intDiv(count, validatorClientCount);
  const vcs = [];
  while(count > 0) {
    if(count > validatorsPerValidatorClient) {
      vcs.push(
        getDevValidator(
          node,
          vcs.length * validatorsPerValidatorClient,
          validatorsPerValidatorClient
        )
      );
    } else {
      vcs.push(
        getDevValidator(
          node,
          vcs.length * validatorsPerValidatorClient,
          count
        )
      );
    }
    count = count - validatorsPerValidatorClient;
  }
  return vcs;
}

export function getDevValidator(node: BeaconNode, startIndex: number, count: number): Validator {
  const logger=new WinstonLogger({level: LogLevel.debug, module: "validator"});
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  return new Validator({
    config: node.config,
    db: new ValidatorDB({
      config: node.config,
      controller: new LevelDbController({
        name: tmpDir.name
      }, {logger})
    }),
    api: new ApiClientOverInstance({
      config: node.config,
      validator: new ValidatorApi({}, {...node, logger}),
      node: new NodeApi({}, {...node}),
      beacon: new BeaconApi({}, {...node}),
    }),
    logger: logger,
    keypairs: Array.from({length: count},(_, i) => {
      return new Keypair(PrivateKey.fromBytes(interopKeypair(i + startIndex).privkey));
    })
  });
}
