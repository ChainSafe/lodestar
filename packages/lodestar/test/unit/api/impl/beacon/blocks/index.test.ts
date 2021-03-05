import {config} from "@chainsafe/lodestar-config/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import { BeaconBlockApi } from "../../../../../../src/api/impl/beacon/blocks";
import { IBeaconChain, ForkChoice, BeaconChain } from "../../../../../../src/chain";
import { INetwork, Network } from "../../../../../../src/network";
import { BeaconSync, IBeaconSync } from "../../../../../../src/sync";
import { StubbedBeaconDb } from "../../../../../utils/stub";

export let blockApi: BeaconBlockApi, chainStub: SinonStubbedInstance<IBeaconChain>, dbStub: StubbedBeaconDb, forkChoiceStub: SinonStubbedInstance<ForkChoice>, syncStub: SinonStubbedInstance<IBeaconSync>, networkStub: SinonStubbedInstance<INetwork>, sandbox = sinon.createSandbox();


beforeEach(function () {
  forkChoiceStub = sinon.createStubInstance(ForkChoice);
  chainStub = sinon.createStubInstance(BeaconChain);
  syncStub = sinon.createStubInstance(BeaconSync);
  chainStub.forkChoice = forkChoiceStub;
  dbStub = new StubbedBeaconDb(sinon, config);
  networkStub = sinon.createStubInstance(Network);
  blockApi = new BeaconBlockApi(
    {},
    {
      chain: chainStub,
      config,
      db: dbStub,
      network: networkStub,
      sync: syncStub,
    }
  );
});

afterEach(function () {
  sandbox.restore();
});