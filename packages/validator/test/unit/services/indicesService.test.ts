import {toBufferBE} from "bigint-buffer";
import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {testLogger} from "../../utils/logger.js";
import {IndicesService} from "../../../src/services/indices.js";

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
    indicesService.removeDutiesForKey(pubkey2);

    expect(Object.fromEntries(indicesService.index2pubkey)).to.deep.equal(
      {
        "0": `${pubkey1}`,
      },
      "Wrong indicesService.index2pubkey Map"
    );

    expect(Object.fromEntries(indicesService.pubkey2index)).to.deep.equal(
      {
        [`${pubkey1}`]: 0,
      },
      "Wrong indicesService.pubkey2index Map"
    );
  });
});
