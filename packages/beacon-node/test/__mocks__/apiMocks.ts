/* eslint-disable @typescript-eslint/naming-convention */
import {config} from "@lodestar/config/default";
import {ChainForkConfig} from "@lodestar/config";
import {getBeaconBlockApi} from "../../src/api/impl/beacon/blocks/index.js";
import {getMockedBeaconChain, MockedBeaconChain} from "./mockedBeaconChain.js";
import {MockedBeaconSync, getMockedBeaconSync} from "./beaconSyncMock.js";
import {MockedBeaconDb, getMockedBeaconDb} from "./mockedBeaconDb.js";
import {MockedNetwork, getMockedNetwork} from "./mockedNetwork.js";

export type ApiImplTestModules = {
  forkChoiceStub: MockedBeaconChain["forkChoice"];
  chainStub: MockedBeaconChain;
  syncStub: MockedBeaconSync;
  dbStub: MockedBeaconDb;
  networkStub: MockedNetwork;
  blockApi: ReturnType<typeof getBeaconBlockApi>;
  config: ChainForkConfig;
};

export function setupApiImplTestServer(): ApiImplTestModules {
  const chainStub = getMockedBeaconChain();
  const forkChoiceStub = chainStub.forkChoice;
  const syncStub = getMockedBeaconSync();
  const dbStub = getMockedBeaconDb();
  const networkStub = getMockedNetwork();

  const blockApi = getBeaconBlockApi({
    chain: chainStub,
    config,
    db: dbStub,
    network: networkStub,
    metrics: null,
  });

  return {
    forkChoiceStub,
    chainStub,
    syncStub,
    dbStub,
    networkStub,
    blockApi,
    config,
  };
}
