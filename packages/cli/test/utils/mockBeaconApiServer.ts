import {RestApiServer, RestApiServerOpts, RestApiServerModules} from "@lodestar/beacon-node";
import {registerRoutes} from "@lodestar/api/beacon/server";
import {Api as ClientApi, allNamespaces, ServerApi} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {testLogger} from "../../../beacon-node/test/utils/logger.js";

const ZERO_HASH_HEX = toHex(Buffer.alloc(32, 0));

type Api = {[K in keyof ClientApi]: ServerApi<ClientApi[K]>};
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type MockBeaconApiOpts = {
  genesisValidatorsRoot?: string;
};

class MockBeaconRestApiServer extends RestApiServer {
  constructor(optsArg: RestApiServerOpts, modules: RestApiServerModules, config: ChainForkConfig, api: Api) {
    super(optsArg, modules);

    // Instantiate and register the routes with matching namespace in `opts.api`
    registerRoutes(this.server, config, api, allNamespaces);
  }
}

export function getMockBeaconApiServer(opts: RestApiServerOpts, apiOpts?: MockBeaconApiOpts): MockBeaconRestApiServer {
  const api = {
    beacon: {
      // Return random genesis data, for genesisValidatorsRoot
      async getGenesis() {
        const genesis = ssz.phase0.Genesis.defaultValue();
        if (apiOpts?.genesisValidatorsRoot) {
          genesis.genesisValidatorsRoot = fromHex(apiOpts?.genesisValidatorsRoot);
        }
        return {data: genesis};
      },

      // Return empty to never discover the validators
      async getStateValidators() {
        return {data: [], executionOptimistic: false};
      },
    },

    config: {
      // Return empty spec to skip config validation
      async getSpec() {
        return {data: {}};
      },
    },

    events: {
      eventstream() {
        // Do nothing
      },
    },

    validator: {
      async getProposerDuties() {
        return {data: [], dependentRoot: ZERO_HASH_HEX, executionOptimistic: false};
      },
      async prepareBeaconProposer() {
        // Do nothing
      },
    },
  } as DeepPartial<Api>;

  const logger = testLogger("mock-beacon-api");
  const restApiServer = new MockBeaconRestApiServer(opts, {logger, metrics: null}, config, api as Api);

  return restApiServer;
}
