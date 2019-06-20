import Validator from "../validator";
import defaults from "../validator/defaults";
import {IValidatorDB, ValidatorDB, BeaconDB} from "../db/api";
import {LevelDbController} from "../db/controller";
import {RpcClient, RpcClientOverInstance} from "../validator/rpc";
import {BeaconApi} from "../rpc/api/beacon";
import {ValidatorApi} from "../rpc/api/validator";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import fs from "fs";
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import {ValidatorCtx} from "../validator/types";
import {BeaconChain} from "../chain";
import {ILogger} from "../logger";
import {OpPool} from "../opPool";
import keystore from "../validator/keystore";

/*export interface ValidatorOptions {
  key?: string;
  dbValidator?: string;
  chain: BeaconChain;
  db: BeaconDB;
  opPool: OpPool;
}*/

export function initValidator({key, password, dbValidator, chain, dbBeacon, opPool},
  logger: ILogger): Validator {
  let dbName: string;
  if (dbValidator) {
    dbName = dbValidator;
  } else {
    dbName = defaults.db.name;
  }
  let db = new ValidatorDB({
    controller: new LevelDbController({
      name: dbName
    }, {
      logger: logger
    })
  });

  const rpcClient = new RpcClientOverInstance({
    beacon: new BeaconApi({}, {chain: chain, db: dbBeacon}),
    validator: new ValidatorApi({}, {chain: chain, db: dbBeacon, opPool: opPool})
  });

  let keypair: Keypair;
  if (key) {
    if (fs.existsSync(key)) {
      keypair = keystore.getKeyFromKeyStore(key, password);
    } else {
      keypair = new Keypair(PrivateKey.fromHexString(key));
    }
  } else {
    throw new Error("Provide keystore file path or private key.");
  }

  let validatorCtx: ValidatorCtx = {
    rpc: rpcClient,
    keypair: keypair,
    db: db,
  };

  return new Validator(validatorCtx, logger);
}