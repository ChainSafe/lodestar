import {toBufferBE} from "bigint-buffer";
import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {ValidatorStore} from "../../../src/services/validatorStore";
import {getApiClientStub} from "../../utils/apiStub";
import {testLogger} from "../../utils/logger";
import {IndicesService} from "../../../src/services/indices";

describe("IndicesService", function () {
  const sandbox = sinon.createSandbox();
  const logger = testLogger();
  const api = getApiClientStub(sandbox);
  const validatorStore = sinon.createStubInstance(ValidatorStore) as ValidatorStore &
    sinon.SinonStubbedInstance<ValidatorStore>;

  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  before(() => {
    const secretKeys = [
      bls.SecretKey.fromBytes(toBufferBE(BigInt(98), 32)),
      bls.SecretKey.fromBytes(toBufferBE(BigInt(99), 32)),
    ];
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
  });

  it("Should remove pubkey", async function () {
    const indicesService = new IndicesService(logger, api, validatorStore);
    const firstValidatorIndex = 0;
    const secondValidatorIndex = 1;

    const pubkey1 = toHexString(pubkeys[firstValidatorIndex]);
    const pubkey2 = toHexString(pubkeys[secondValidatorIndex]);

    indicesService.index2pubkey.set(firstValidatorIndex, pubkey1);
    indicesService.index2pubkey.set(secondValidatorIndex, pubkey2);

    indicesService.pubkey2index.set(pubkey1, firstValidatorIndex);
    indicesService.pubkey2index.set(pubkey2, secondValidatorIndex);

    // remove pubkey2
    indicesService.remove(pubkey2);

    expect(Array.from(indicesService.index2pubkey.values()).includes(pubkey2)).to.be.false;
    expect(Array.from(indicesService.pubkey2index.keys()).includes(pubkey2)).to.be.false;
    expect(Array.from(indicesService.index2pubkey.values()).includes(pubkey1)).to.be.true;
    expect(Array.from(indicesService.pubkey2index.keys()).includes(pubkey1)).to.be.true;
  });
});
