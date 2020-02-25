import sinon, { SinonStubbedInstance } from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {assembleAttestationData} from "../../../../../src/chain/factory/attestation/data";
import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import {BlockRepository} from "../../../../../src/db/api/beacon/repositories";
import { IBeaconConfig } from "@chainsafe/lodestar-config";
import { IBeaconDb } from "../../../../db";

describe("assemble attestation data", function () {

  const sandbox = sinon.createSandbox();
  let  dbStub: {
    block: SinonStubbedInstance<BlockRepository>;
    config?: IBeaconConfig;
  };

  beforeEach(() => {
    dbStub = {
      block: sandbox.createStubInstance(BlockRepository)
    };
    dbStub.config = config;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should produce attestation', async function () {
    const state = generateState({slot: 2});
    const block = generateEmptyBlock();
    const result = await assembleAttestationData(config, dbStub as unknown as IBeaconDb, state, block, 2, 1);
    expect(result).to.not.be.null;
  });

});
