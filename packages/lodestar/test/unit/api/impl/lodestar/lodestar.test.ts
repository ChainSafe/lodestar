import {createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import {ILodestarApi, LodestarApi} from "../../../../../src/api/impl/lodestar";
import {generateState} from "../../../../utils/state";

describe("Lodestar api impl", function () {
  let api: ILodestarApi;

  beforeEach(async function () {
    api = new LodestarApi({config});
  });

  it("should get latest weak subjectivity checkpoint epoch", async function () {
    const cachedState = createCachedBeaconState(config, generateState());
    const epoch = await api.getLatestWeakSubjectivityCheckpointEpoch(cachedState);
    expect(epoch).to.be.equal(0);
  });
});
