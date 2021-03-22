import {config} from "@chainsafe/lodestar-config/minimal";
import {SinonSandbox, SinonStubbedInstance} from "sinon";
import sinon from "sinon";
import {BeaconBlockApi} from "../../../../src/api/impl/beacon/blocks";
import {ForkChoice, BeaconChain} from "../../../../src/chain";
import {Network} from "../../../../src/network";
import {BeaconSync} from "../../../../src/sync";
import {StubbedBeaconDb} from "../../../utils/stub";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {createStubInstance} from "../../../utils/types";

export type ApiImplTestModules = {
  sandbox: SinonSandbox;
  forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  chainStub: SinonStubbedInstance<BeaconChain>;
  syncStub: SinonStubbedInstance<BeaconSync>;
  dbStub: StubbedBeaconDb;
  networkStub: SinonStubbedInstance<Network>;
  blockApi: BeaconBlockApi;
  config: IBeaconConfig;
};

export function setupApiImplTestServer(): ApiImplTestModules {
  const sandbox = sinon.createSandbox();
  const forkChoiceStub = createStubInstance(ForkChoice);
  const chainStub = createStubInstance(BeaconChain);
  const syncStub = createStubInstance(BeaconSync);
  const dbStub = new StubbedBeaconDb(sinon, config);
  const networkStub = createStubInstance(Network);
  const blockApi = new BeaconBlockApi(
    {},
    {
      chain: chainStub,
      config,
      db: dbStub,
      network: networkStub,
      sync: syncStub,
    }
  );
  chainStub.forkChoice = forkChoiceStub;
  return {
    sandbox,
    forkChoiceStub,
    chainStub,
    syncStub,
    dbStub,
    networkStub,
    blockApi,
    config,
  };
}
