import {IService} from "../node";
import defaultOptions, {IApiOptions} from "./options";
import {IApiModules} from "./interface";
import deepmerge from "deepmerge";
import {RestApi} from "./rest";
import {BeaconApi} from "./impl/beacon";
import {ValidatorApi} from "./impl/validator";
import {NodeApi} from "./impl/node/node";

export * from "./interface";

export const enum ApiNamespace {
  BEACON = "beacon",
  VALIDATOR = "validator",
  NODE = "node"
}

export class ApiService implements IService {

  private opts: IApiOptions;

  private rest: IService;

  public constructor(opts: Partial<IApiOptions>, modules: IApiModules) {
    this.opts = deepmerge(defaultOptions, opts);
    if(this.opts.rest.enabled) {
      this.rest = this.setupRestApi(modules);
    }
  }

  public async start(): Promise<void> {
    if(this.rest) {
      await this.rest.start();
    }
  }

  public async stop(): Promise<void> {
    if(this.rest) {
      await this.rest.stop();
    }
  }

  private setupRestApi(modules: IApiModules): RestApi {
    return new RestApi(
      this.opts.rest,
      {
        config: modules.config,
        logger: modules.logger,
        beacon: new BeaconApi({}, modules),
        node: new NodeApi({}, modules),
        validator: new ValidatorApi({}, modules)
      });
  }
}
