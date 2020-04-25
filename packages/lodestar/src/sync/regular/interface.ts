import {IService} from "../../node";
import {ISyncModule, ISyncModules} from "../index";

export type IRegularSync = IService & ISyncModule;

export type IRegularSyncModules =
    Pick<ISyncModules, "config"|"chain"|"network"|"logger"|"reputationStore">;