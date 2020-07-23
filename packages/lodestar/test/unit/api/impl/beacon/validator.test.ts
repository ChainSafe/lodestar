import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {BeaconApi, IBeaconApi} from "../../../../../src/api/impl/beacon";
import {BeaconChain, IBeaconChain} from "../../../../../src/chain";
import {generateState} from "../../../../utils/state";
import {generateValidator} from "../../../../utils/validator";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {PrivateKey, PublicKey} from "@chainsafe/bls";


describe("get validator details api", function () {

  const sandbox = sinon.createSandbox();

  let chainStub: SinonStubbedInstance<IBeaconChain>;

  let api: IBeaconApi;

  beforeEach(function () {
    chainStub = sinon.createStubInstance(BeaconChain);
    // @ts-ignore
    api = new BeaconApi({}, {chain: chainStub, config});
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should get validator details", async function () {
    const state = generateState({
      validators: [
        generateValidator({
          pubkey: PublicKey.fromPrivateKey(PrivateKey.fromInt(1)).toBytesCompressed()
        }),
        generateValidator({
          pubkey: PublicKey.fromPrivateKey(PrivateKey.fromInt(2)).toBytesCompressed(),
          slashed: true
        })
      ]
    });
    const epochCtx = new EpochContext(config);
    epochCtx.syncPubkeys(state);
    chainStub.getHeadStateContext.resolves({
      state,
      epochCtx
    });
    const result = await api.getValidator(PublicKey.fromPrivateKey(PrivateKey.fromInt(2)).toBytesCompressed());
    expect(result.validator.slashed).to.be.true;
    expect(result.index).to.be.equal(1);
  });

  it("validators not found", async function () {
    chainStub.getHeadStateContext.resolves(
      {
        state: generateState({
          validators: [
            generateValidator({
              pubkey: Buffer.alloc(48, 1),
              slashed: true
            }),
            generateValidator({
              pubkey: Buffer.alloc(48, 2)
            })
          ]
        }),
        epochCtx: new EpochContext(config)
      }
    );
    const result = await api.getValidator(Buffer.alloc(48, 3));
    expect(result).to.be.null;
  });

});
