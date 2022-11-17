import {getMetrics as getReqResMetrics, IReqResp, MetricsRegister} from "@lodestar/reqresp";
import messages from "@lodestar/reqresp/messages";
import {IMetrics} from "../../metrics/index.js";
import {BeaconNodeReqResp, BeaconNodeReqRespModules} from "./BeaconNodeReqResp.js";
import {ReqRespHandlers} from "./handlers/index.js";

export const getBeaconNodeReqResp = (
  modules: Omit<BeaconNodeReqRespModules, "metrics"> & {
    metrics: IMetrics | null;
  },
  reqRespHandlers: ReqRespHandlers
): IReqResp => {
  const metrics = modules.metrics
    ? getReqResMetrics((modules.metrics as unknown) as MetricsRegister, {
        version: "",
        commit: "",
        network: "",
      })
    : null;

  const reqRespModules = {
    ...modules,
    metrics,
  } as BeaconNodeReqRespModules;

  const reqresp = new BeaconNodeReqResp(reqRespModules);

  reqresp.registerProtocol(messages.v1.Ping(reqRespModules));
  reqresp.registerProtocol(messages.v1.Status(reqRespModules, reqRespHandlers.onStatus));
  reqresp.registerProtocol(messages.v1.Metadata(reqRespModules));
  reqresp.registerProtocol(messages.v1.Goodbye(reqRespModules));
  reqresp.registerProtocol(messages.v1.BeaconBlocksByRange(reqRespModules, reqRespHandlers.onBeaconBlocksByRange));
  reqresp.registerProtocol(messages.v1.BeaconBlocksByRoot(reqRespModules, reqRespHandlers.onBeaconBlocksByRoot));
  reqresp.registerProtocol(messages.v1.LightClientBootstrap(reqRespModules, reqRespHandlers.onLightClientBootstrap));
  reqresp.registerProtocol(
    messages.v1.LightClientFinalityUpdate(reqRespModules, reqRespHandlers.onLightClientFinalityUpdate)
  );
  reqresp.registerProtocol(
    messages.v1.LightClientOptimisticUpdate(reqRespModules, reqRespHandlers.onLightClientOptimisticUpdate)
  );
  reqresp.registerProtocol(
    messages.v1.LightClientUpdatesByRange(reqRespModules, reqRespHandlers.onLightClientUpdatesByRange)
  );

  reqresp.registerProtocol(messages.v2.Metadata(reqRespModules));
  reqresp.registerProtocol(messages.v2.BeaconBlocksByRange(reqRespModules, reqRespHandlers.onBeaconBlocksByRange));
  reqresp.registerProtocol(messages.v2.BeaconBlocksByRoot(reqRespModules, reqRespHandlers.onBeaconBlocksByRoot));

  return reqresp;
};
