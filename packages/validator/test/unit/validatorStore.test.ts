import {toBufferBE} from "bigint-buffer";
import {expect} from "chai";
import sinon from "sinon";
import {chainConfig} from "@lodestar/config/default";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {ValidatorStore} from "../../src/services/validatorStore.js";
import {getApiClientStub} from "../utils/apiStub.js";
import {initValidatorStore} from "../utils/validatorStore.js";
import {ValidatorProposerConfig} from "../../src/services/validatorStore.js";

describe("ValidatorStore", function () {
  const sandbox = sinon.createSandbox();
  const api = getApiClientStub(sandbox);

  let validatorStore: ValidatorStore;

  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized
  let valProposerConfig: ValidatorProposerConfig;

  before(() => {
    const secretKeys = Array.from({length: 3}, (_, i) => bls.SecretKey.fromBytes(toBufferBE(BigInt(i + 1), 32)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());

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
      valProposerConfig.proposerConfig[toHexString(pubkeys[0])].builder.enabled
    );
    expect(validatorStore.strictFeeRecipientCheck(toHexString(pubkeys[0]))).to.be.equal(
      valProposerConfig.proposerConfig[toHexString(pubkeys[0])].strictFeeRecipientCheck
    );
    expect(validatorStore.getGasLimit(toHexString(pubkeys[0]))).to.be.equal(
      valProposerConfig.proposerConfig[toHexString(pubkeys[0])].builder.gasLimit
    );

    // default values
    expect(validatorStore.getGraffiti(toHexString(pubkeys[1]))).to.be.equal(valProposerConfig.defaultConfig.graffiti);
    expect(validatorStore.getFeeRecipient(toHexString(pubkeys[1]))).to.be.equal(
      valProposerConfig.defaultConfig.feeRecipient
    );
    expect(validatorStore.isBuilderEnabled(toHexString(pubkeys[1]))).to.be.equal(
      valProposerConfig.defaultConfig.builder.enabled
    );
    expect(validatorStore.strictFeeRecipientCheck(toHexString(pubkeys[1]))).to.be.equal(
      valProposerConfig.defaultConfig.strictFeeRecipientCheck
    );
    expect(validatorStore.getGasLimit(toHexString(pubkeys[1]))).to.be.equal(
      valProposerConfig.defaultConfig.builder.gasLimit
    );
  });
});
