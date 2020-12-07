import {IApiOptions} from "../../options";
import {IApiModules} from "../interface";
import {DebugBeaconApi} from "./beacon";
import {IDebugBeaconApi} from "./beacon/interface";
import {IDebugApi} from "./interface";

export class DebugApi implements IDebugApi {
  public beacon: IDebugBeaconApi;

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "logger" | "chain">) {
    this.beacon = new DebugBeaconApi(opts, modules);
  }
}
