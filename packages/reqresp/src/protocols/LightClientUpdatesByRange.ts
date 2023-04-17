import {MAX_REQUEST_LIGHT_CLIENT_UPDATES, isForkLightClient} from "@lodestar/params";
import {altair, ssz, allForks} from "@lodestar/types";
import {DialOnlyProtocolDefinition, Encoding, MixedProtocolDefinitionGenerator} from "../types.js";
import {getContextBytesLightclient} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LightClientUpdatesByRange: MixedProtocolDefinitionGenerator<
  altair.LightClientUpdatesByRange,
  allForks.LightClientUpdate
> = ((modules, handler) => {
  const dialProtocol: DialOnlyProtocolDefinition<altair.LightClientUpdatesByRange, allForks.LightClientUpdate> = {
    method: "light_client_updates_by_range",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    requestType: () => ssz.altair.LightClientUpdatesByRange,
    responseType: (forkName) =>
      isForkLightClient(forkName) ? ssz.allForksLightClient[forkName].LightClientUpdate : ssz.altair.LightClientUpdate,
    contextBytes: getContextBytesLightclient((update) => modules.config.getForkName(update.signatureSlot), modules),
  };

  if (!handler) return dialProtocol;

  return {
    ...dialProtocol,
    handler,
    renderRequestBody: (req) => `${req.startPeriod},${req.count}`,
    inboundRateLimits: {
      // Same rationale as for BeaconBlocksByRange
      byPeer: {quota: MAX_REQUEST_LIGHT_CLIENT_UPDATES, quotaTimeMs: 10_000},
      getRequestCount: (req) => req.count,
    },
  };
}) as MixedProtocolDefinitionGenerator<altair.LightClientUpdatesByRange, allForks.LightClientUpdate>;
