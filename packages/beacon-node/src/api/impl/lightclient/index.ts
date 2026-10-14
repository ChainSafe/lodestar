import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {MAX_REQUEST_LIGHT_CLIENT_COMMITTEE_HASHES, MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import type {LightClientUpdate} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {LightClientServerError, LightClientServerErrorCode} from "../../../chain/errors/lightClientError.js";
import {assertLightClientServerEnabled} from "../../../node/utils/lightclient.js";
import {ApiModules} from "../types.js";
// TODO: Import from lightclient/server package

export function getLightclientApi({
  chain,
  config,
}: Pick<ApiModules, "chain" | "config">): ApplicationMethods<routes.lightclient.Endpoints> {
  return {
    async getLightClientUpdatesByRange({startPeriod, count}) {
      assertLightClientServerEnabled(chain.opts.disableLightClientServer);

      const maxAllowedCount = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, count);
      const updates: LightClientUpdate[] = [];
      for (let i = 0; i < maxAllowedCount; i++) {
        try {
          const update = await chain.beaconEngine.getLightClientUpdate(startPeriod + i);
          updates.push(config.getPostAltairForkTypes(update.slot).LightClientUpdate.deserialize(update.data));
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

    async getLightClientOptimisticUpdate(_args, context) {
      assertLightClientServerEnabled(chain.opts.disableLightClientServer);

      const update = await chain.beaconEngine.getLightClientOptimisticUpdate();
      if (update === null) {
        throw Error("No optimistic update available");
      }
      return {
        data: context?.returnBytes
          ? update.data
          : config.getPostAltairForkTypes(update.slot).LightClientOptimisticUpdate.deserialize(update.data),
        meta: {version: config.getForkName(update.slot)},
      };
    },

    async getLightClientFinalityUpdate(_args, context) {
      assertLightClientServerEnabled(chain.opts.disableLightClientServer);

      const update = await chain.beaconEngine.getLightClientFinalityUpdate();
      if (update === null) {
        throw Error("No finality update available");
      }
      return {
        data: context?.returnBytes
          ? update.data
          : config.getPostAltairForkTypes(update.slot).LightClientFinalityUpdate.deserialize(update.data),
        meta: {version: config.getForkName(update.slot)},
      };
    },

    async getLightClientBootstrap({blockRoot}, context) {
      assertLightClientServerEnabled(chain.opts.disableLightClientServer);

      const bootstrapProof = await chain.beaconEngine.getLightClientBootstrap(fromHex(blockRoot));
      return {
        data: context?.returnBytes
          ? bootstrapProof.data
          : config.getPostAltairForkTypes(bootstrapProof.slot).LightClientBootstrap.deserialize(bootstrapProof.data),
        meta: {version: config.getForkName(bootstrapProof.slot)},
      };
    },

    async getLightClientCommitteeRoot({startPeriod, count}) {
      assertLightClientServerEnabled(chain.opts.disableLightClientServer);

      const maxAllowedCount = Math.min(MAX_REQUEST_LIGHT_CLIENT_COMMITTEE_HASHES, count);
      const periods = Array.from({length: maxAllowedCount}, (_ignored, i) => i + startPeriod);
      const committeeHashes = await Promise.all(
        periods.map((period) => chain.beaconEngine.getLightClientCommitteeRoot(period))
      );
      return {data: committeeHashes};
    },
  };
}
