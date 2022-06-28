import {RestApiServer, RestApiServerOpts, RestApiServerModules} from "@chainsafe/lodestar";
import {registerRoutes} from "@chainsafe/lodestar-api/beacon/server";
import {Api, allNamespaces} from "@chainsafe/lodestar-api";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {config} from "@chainsafe/lodestar-config/default";
import {ssz} from "@chainsafe/lodestar-types";
import {fromHex} from "@chainsafe/lodestar-utils";
import {testLogger} from "../../../lodestar/test/utils/logger.js";

const ZERO_HASH = Buffer.alloc(32, 0);

export type MockBeaconApiOpts = {
  genesisValidatorsRoot?: string;
};

class MockBeaconRestApiServer extends RestApiServer {
  constructor(optsArg: RestApiServerOpts, modules: RestApiServerModules, config: IChainForkConfig, api: Api) {
    super(optsArg, modules);

    // Instantiate and register the routes with matching namespace in `opts.api`
    registerRoutes(this.server, config, api, allNamespaces);
  }
}

export function getMockBeaconApiServer(opts: RestApiServerOpts, apiOpts?: MockBeaconApiOpts): MockBeaconRestApiServer {
  const api = ({
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
        return {data: []};
      },
    } as Partial<Api["beacon"]>,

    config: {
      // Return empty spec to skip config validation
      async getSpec() {
        return {data: {}};
      },
    } as Partial<Api["config"]>,

    events: {
      eventstream() {
        // Do nothing
      },
    },

    validator: {
      async getProposerDuties() {
        return {data: [], dependentRoot: ZERO_HASH};
      },
      async prepareBeaconProposer() {
        // Do nothing
      },
    } as Partial<Api["validator"]>,
  } as Partial<Api>) as Api;

  const logger = testLogger("mock-beacon-api");
  const restApiServer = new MockBeaconRestApiServer(opts, {logger, metrics: null}, config, api);

  return restApiServer;
}
