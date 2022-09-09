import {toBufferBE} from "bigint-buffer";
import {expect} from "chai";
import sinon from "sinon";
import {chainConfig} from "@lodestar/config/default";
import bls from "@chainsafe/bls";
import {toHexString, fromHexString} from "@chainsafe/ssz";
import {bellatrix} from "@lodestar/types";

import {ValidatorStore} from "../../src/services/validatorStore.js";
import {getApiClientStub} from "../utils/apiStub.js";
import {initValidatorStore} from "../utils/validatorStore.js";
import {ValidatorProposerConfig} from "../../src/services/validatorStore.js";
import {SinonStubFn} from "..//utils/types.js";

describe("ValidatorStore", function () {
  const sandbox = sinon.createSandbox();
  const api = getApiClientStub(sandbox);

  let validatorStore: ValidatorStore;

  let valProposerConfig: ValidatorProposerConfig;
  let signValidatorStub: SinonStubFn<ValidatorStore["signValidatorRegistration"]>;

  before(() => {
    valProposerConfig = {
      proposerConfig: {
        [toHexString(pubkeys[0])]: {
          graffiti: "graffiti",
          strictFeeRecipientCheck: true,
          feeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          builder: {
            enabled: false,
            gasLimit: 30000000,
          },
        },
      },
      defaultConfig: {
        graffiti: "default graffiti",
        strictFeeRecipientCheck: false,
        feeRecipient: "0xcccccccccccccccccccccccccccccccccccccccc",
        builder: {
          enabled: true,
          gasLimit: 35000000,
        },
      },
    };

    validatorStore = initValidatorStore(secretKeys, api, chainConfig, valProposerConfig);
    signValidatorStub = sinon.stub(validatorStore, "signValidatorRegistration");
  });

  after(() => {
    sandbox.restore();
  });

  it("Should validate graffiti,feeRecipient etc. from valProposerConfig and ValidatorStore", async function () {
    //pubkeys[0] values
    expect(validatorStore.getGraffiti(toHexString(pubkeys[0]))).to.be.equal(
      valProposerConfig.proposerConfig[toHexString(pubkeys[0])].graffiti
    );
    expect(validatorStore.getFeeRecipient(toHexString(pubkeys[0]))).to.be.equal(
      valProposerConfig.proposerConfig[toHexString(pubkeys[0])].feeRecipient
    );
    expect(validatorStore.isBuilderEnabled(toHexString(pubkeys[0]))).to.be.equal(
      valProposerConfig.proposerConfig[toHexString(pubkeys[0])].builder?.enabled
    );
    expect(validatorStore.strictFeeRecipientCheck(toHexString(pubkeys[0]))).to.be.equal(
      valProposerConfig.proposerConfig[toHexString(pubkeys[0])].strictFeeRecipientCheck
    );
    expect(validatorStore.getGasLimit(toHexString(pubkeys[0]))).to.be.equal(
      valProposerConfig.proposerConfig[toHexString(pubkeys[0])].builder?.gasLimit
    );

    // default values
    expect(validatorStore.getGraffiti(toHexString(pubkeys[1]))).to.be.equal(valProposerConfig.defaultConfig.graffiti);
    expect(validatorStore.getFeeRecipient(toHexString(pubkeys[1]))).to.be.equal(
      valProposerConfig.defaultConfig.feeRecipient
    );
    expect(validatorStore.isBuilderEnabled(toHexString(pubkeys[1]))).to.be.equal(
      valProposerConfig.defaultConfig.builder?.enabled
    );
    expect(validatorStore.strictFeeRecipientCheck(toHexString(pubkeys[1]))).to.be.equal(
      valProposerConfig.defaultConfig.strictFeeRecipientCheck
    );
    expect(validatorStore.getGasLimit(toHexString(pubkeys[1]))).to.be.equal(
      valProposerConfig.defaultConfig.builder?.gasLimit
    );
  });

  it("Should create/update builder data and return from cache next time", async () => {
    let signCallCount = 0;
    let slot = 0;
    const testCases: [bellatrix.SignedValidatorRegistrationV1, string, number][] = [
      [valRegF00G100, "0x00", 100],
      [valRegF10G100, "0x10", 100],
      [valRegF10G200, "0x10", 200],
    ];
    for (const [valReg, feeRecipient, gasLimit] of testCases) {
      signValidatorStub.resolves(valReg);
      const val1 = await validatorStore.getValidatorRegistration(pubkeys[0], {feeRecipient, gasLimit}, slot++);
      expect(JSON.stringify(val1) === JSON.stringify(valReg));
      expect(signValidatorStub.callCount).to.equal(
        ++signCallCount,
        `signValidatorRegistration() must be updated for new feeRecipient=${feeRecipient} gasLimit=${gasLimit} combo `
      );
      const val2 = await validatorStore.getValidatorRegistration(pubkeys[0], {feeRecipient, gasLimit}, slot++);
      expect(JSON.stringify(val2) === JSON.stringify(valReg));
      expect(signValidatorStub.callCount).to.equal(
        signCallCount,
        `signValidatorRegistration() must be updated for same feeRecipient=${feeRecipient} gasLimit=${gasLimit} combo `
      );
    }
  });
});

const secretKeys = Array.from({length: 3}, (_, i) => bls.SecretKey.fromBytes(toBufferBE(BigInt(i + 1), 32)));
const pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());

const valRegF00G100 = {
  message: {
    feeRecipient: fromHexString("0x00"),
    gasLimit: 100,
    timestamp: Date.now(),
    pubkey: pubkeys[0],
  },
  signature: Buffer.alloc(96, 0),
};

const valRegF10G100 = {
  message: {
    feeRecipient: fromHexString("0x10"),
    gasLimit: 100,
    timestamp: Date.now(),
    pubkey: pubkeys[0],
  },
  signature: Buffer.alloc(96, 0),
};

const valRegF10G200 = {
  message: {
    feeRecipient: fromHexString("0x10"),
    gasLimit: 200,
    timestamp: Date.now(),
    pubkey: pubkeys[0],
  },
  signature: Buffer.alloc(96, 0),
};
