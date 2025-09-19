import {config} from "@lodestar/config/default";
import {ForkChoice} from "@lodestar/fork-choice";
import {Mocked} from "vitest";
import {ApiModules} from "../../src/api/index.js";
import {getMockedBeaconSync} from "../mocks/beaconSyncMock.js";
import {MockedBeaconChain, MockedBeaconChainOptions, getMockedBeaconChain} from "../mocks/mockedBeaconChain.js";
import {MockedBeaconDb, getMockedBeaconDb} from "../mocks/mockedBeaconDb.js";
import {getMockedNetwork} from "../mocks/mockedNetwork.js";

type ApiModulesWithoutConfig = Omit<ApiModules, "config" | "chain">;

export type ApiTestModules = {[K in keyof ApiModulesWithoutConfig]: Mocked<ApiModulesWithoutConfig[K]>} & {
  chain: MockedBeaconChain;
  forkChoice: Mocked<ForkChoice>;
  db: MockedBeaconDb;
  config: ApiModules["config"];
};

export function getApiTestModules(opts?: Partial<MockedBeaconChainOptions>): ApiTestModules {
  const chainStub = getMockedBeaconChain(opts);
  const syncStub = getMockedBeaconSync();
  const dbStub = getMockedBeaconDb();
  const networkStub = getMockedNetwork();

  return {
    config,
    chain: chainStub,
    sync: syncStub,
    db: dbStub,
    network: networkStub,
    logger: chainStub.logger,
    forkChoice: chainStub.forkChoice,
    metrics: null,
  };
}
