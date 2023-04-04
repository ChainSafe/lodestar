import {ssz, allForks} from "@lodestar/types";
import {isForkLightClient} from "@lodestar/params";
import {DialOnlyProtocolDefinition, Encoding, MixedProtocolDefinitionGenerator} from "../types.js";
import {getContextBytesLightclient} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LightClientOptimisticUpdate: MixedProtocolDefinitionGenerator<null, allForks.LightClientOptimisticUpdate> =
  ((modules, handler) => {
    const dialProtocol: DialOnlyProtocolDefinition<null, allForks.LightClientOptimisticUpdate> = {
      method: "light_client_optimistic_update",
      version: 1,
      encoding: Encoding.SSZ_SNAPPY,
      requestType: () => null,
      responseType: (forkName) =>
        isForkLightClient(forkName)
          ? ssz.allForksLightClient[forkName].LightClientOptimisticUpdate
          : ssz.altair.LightClientOptimisticUpdate,
      contextBytes: getContextBytesLightclient((update) => modules.config.getForkName(update.signatureSlot), modules),
    };

    if (!handler) return dialProtocol;

    return {
      ...dialProtocol,
      handler,
      inboundRateLimits: {
        // Optimistic updates should not be requested more than once per slot.
        // Allow 2 per slot and a very safe bound until there's more testing of real usage.
        byPeer: {quota: 2, quotaTimeMs: 12_000},
      },
    };
  }) as MixedProtocolDefinitionGenerator<null, allForks.LightClientOptimisticUpdate>;
