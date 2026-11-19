import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {MAX_REQUEST_LIGHT_CLIENT_COMMITTEE_HASHES, MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import type {LightClientUpdate} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {LightClientServerError, LightClientServerErrorCode} from "../../../chain/errors/lightClientError.js";
import {assertLightClientServer} from "../../../node/utils/lightclient.js";
import {ApiModules} from "../types.js";
// TODO: Import from lightclient/server package

export function getLightclientApi({
  chain,
  config,
}: Pick<ApiModules, "chain" | "config">): ApplicationMethods<routes.lightclient.Endpoints> {
  return {
    async getLightClientUpdatesByRange({startPeriod, count}) {
      const lightClientServer = chain.lightClientServer;
      assertLightClientServer(lightClientServer);

      const maxAllowedCount = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, count);
      const updates: LightClientUpdate[] = [];
      for (let i = 0; i < maxAllowedCount; i++) {
        try {
          const update = await lightClientServer.getUpdate(startPeriod + i);
          updates.push(update);
        } catch (e) {
          if ((e as LightClientServerError).type?.code === LightClientServerErrorCode.RESOURCE_UNAVAILABLE) {
            // Period not available, if we already have results, stop to preserve
            // consecutive order. If not, skip and try the next period.
            if (updates.length > 0) break;
            continue;
          }
          // Unexpected error
          throw e;
        }
      }

      return {
        data: updates,
        meta: {versions: updates.map((update) => config.getForkName(update.attestedHeader.beacon.slot))},
      };
    },

    async getLightClientOptimisticUpdate() {
      assertLightClientServer(chain.lightClientServer);

      const update = chain.lightClientServer.getOptimisticUpdate();
      if (update === null) {
        throw Error("No optimistic update available");
      }
      return {data: update, meta: {version: config.getForkName(update.attestedHeader.beacon.slot)}};
    },

    async getLightClientFinalityUpdate() {
      assertLightClientServer(chain.lightClientServer);

      const update = chain.lightClientServer.getFinalityUpdate();
      if (update === null) {
        throw Error("No finality update available");
      }
      return {data: update, meta: {version: config.getForkName(update.attestedHeader.beacon.slot)}};
    },

    async getLightClientBootstrap({blockRoot}) {
      assertLightClientServer(chain.lightClientServer);

      const bootstrapProof = await chain.lightClientServer.getBootstrap(fromHex(blockRoot));
      return {data: bootstrapProof, meta: {version: config.getForkName(bootstrapProof.header.beacon.slot)}};
    },

    async getLightClientCommitteeRoot({startPeriod, count}) {
      const lightClientServer = chain.lightClientServer;
      assertLightClientServer(lightClientServer);

      const maxAllowedCount = Math.min(MAX_REQUEST_LIGHT_CLIENT_COMMITTEE_HASHES, count);
      const periods = Array.from({length: maxAllowedCount}, (_ignored, i) => i + startPeriod);
      const committeeHashes = await Promise.all(periods.map((period) => lightClientServer.getCommitteeRoot(period)));
      return {data: committeeHashes};
    },
  };
}
