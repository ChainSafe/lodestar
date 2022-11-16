import {
  getMetrics as getReqResMetrics,
  Handler,
  IReqResp,
  MetricsRegister,
  ReqResp,
  ReqRespModules,
} from "@lodestar/reqresp";
import messages from "@lodestar/reqresp/messages";
import {InboundRateLimiter} from "@lodestar/reqresp/rate_limiter";
import {phase0} from "@lodestar/types";
import {IMetrics} from "../../metrics/index.js";
import {ReqRespHandlers} from "./handlers/index.js";

export const getBeaconNodeReqResp = (
  modules: Omit<ReqRespModules, "metrics" | "inboundRateLimiter"> & {
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

  const inboundRateLimiter = new InboundRateLimiter(
    {},
    {logger: modules.logger, metrics, peerRpcScores: modules.peerRpcScores}
  );

  const reqRespModules = {
    ...modules,
    metrics,
    inboundRateLimiter,
  };

  const reqresp = ReqResp.withDefaults(reqRespModules);

  reqresp.registerProtocol(messages.v1.Status(reqRespHandlers.onStatus, reqRespModules));
  reqresp.registerProtocol(
    messages.v1.Ping(
      async function* onPing() {
        yield;
      } as Handler<phase0.Ping, phase0.Ping>,
      reqRespModules
    )
  );

  return reqresp;
};
