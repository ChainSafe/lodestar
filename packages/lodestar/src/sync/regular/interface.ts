import {IService} from "../../node";
import {ISyncModules} from "../index";

export type IRegularSync = IService;

export type IRegularSyncModules =
    Pick<ISyncModules, "config"|"chain"|"network"|"logger"|"reputationStore">;