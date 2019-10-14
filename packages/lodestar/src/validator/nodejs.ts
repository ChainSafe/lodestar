import defaultConfig, {IValidatorClientOptions} from "./options";
import {ILogger} from "../logger";
import {IService} from "../node";
import {IValidatorDB, ValidatorDB} from "../db/api";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {LevelDbController} from "../db/controller";
import {Validator} from "@chainsafe/lodestar-validator";
import {getKeyFromFileOrKeystore} from "../util/io";
import deepmerge from "deepmerge";

import {isPlainObject} from "@chainsafe/eth2.0-utils";

export class ValidatorClient implements IService {

  private readonly logger: ILogger;
  private readonly opts: IValidatorClientOptions;
  private validator: Validator | null;

  public constructor(opts: Partial<IValidatorClientOptions>, modules: {logger: ILogger}) {
    this.logger = modules.logger;
    this.opts = deepmerge(defaultConfig, opts, {isMergeableObject: isPlainObject});
    if(!this.opts.validatorKey) {
      throw new Error("Missing validator key");
    }
  }

  public async start(): Promise<void> {
    const keypair = await getKeyFromFileOrKeystore(this.opts.validatorKey);
    this.validator = new Validator({
      api: this.opts.restApi,
      config: this.opts.config,
      keypair,
      logger: this.logger,
      db: this.initDb(this.opts.config, this.opts.db)
    });
    await this.validator.start();
  }

  public async stop(): Promise<void> {
    if(this.validator) {
      this.validator.stop();
    }
  }

  private initDb(config: IBeaconConfig, db: string): IValidatorDB {
    return new ValidatorDB({
      config: config,
      controller: new LevelDbController({
        name: db
      },
      {
        logger: this.logger
      })
    });
  }

}