import sinon, {SinonStubbedInstance} from "sinon";
import {digest} from "@chainsafe/as-sha256";
import {config as defaultConfig} from "@lodestar/config/default";
import {computeSigningRoot} from "@lodestar/state-transition";
import {ForkChoice} from "@lodestar/fork-choice";
import {capella, ssz} from "@lodestar/types";
import {
  BLS_WITHDRAWAL_PREFIX,
  ETH1_ADDRESS_WITHDRAWAL_PREFIX,
  DOMAIN_BLS_TO_EXECUTION_CHANGE,
  FAR_FUTURE_EPOCH,
  SLOTS_PER_EPOCH,
  ForkName,
} from "@lodestar/params";
import bls from "@chainsafe/bls";
import {PointFormat} from "@chainsafe/bls/types";
import {createBeaconConfig} from "@lodestar/config";

import {BeaconChain} from "../../../../src/chain/index.js";
import {StubbedChainMutable} from "../../../utils/stub/index.js";
import {generateState} from "../../../utils/state.js";
import {validateBlsToExecutionChange} from "../../../../src/chain/validation/blsToExecutionChange.js";
import {BlsToExecutionChangeErrorCode} from "../../../../src/chain/errors/blsToExecutionChangeError.js";
import {OpPool} from "../../../../src/chain/opPools/index.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";
import {BlsVerifierMock} from "../../../utils/mocks/bls.js";

type StubbedChain = StubbedChainMutable<"forkChoice" | "bls">;

describe("validate bls to execution change", () => {
  const sandbox = sinon.createSandbox();
  let chainStub: StubbedChain;
  let opPool: OpPool & SinonStubbedInstance<OpPool>;

  const stateEmpty = ssz.phase0.BeaconState.defaultValue();
  // Validator has to be active for long enough
  stateEmpty.slot = defaultConfig.SHARD_COMMITTEE_PERIOD * SLOTS_PER_EPOCH;
  // A withdrawal key which we will keep same on the two vals we generate
  const wsk = bls.SecretKey.fromKeygen();

  // Generate and add first val
  const sk1 = bls.SecretKey.fromKeygen();
  const pubkey1 = sk1.toPublicKey().toBytes(PointFormat.compressed);
  const fromBlsPubkey = wsk.toPublicKey().toBytes(PointFormat.compressed);
  const withdrawalCredentials = digest(fromBlsPubkey);
  withdrawalCredentials[0] = BLS_WITHDRAWAL_PREFIX;
  const validator = ssz.phase0.Validator.toViewDU({
    pubkey: pubkey1,
    withdrawalCredentials,
    effectiveBalance: 32e9,
    slashed: false,
    activationEligibilityEpoch: 0,
    activationEpoch: 0,
    exitEpoch: FAR_FUTURE_EPOCH,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
  });
  stateEmpty.validators[0] = validator;

  // Gen and add second val
  const sk2 = bls.SecretKey.fromKeygen();
  const pubkey2 = sk2.toPublicKey().toBytes(PointFormat.compressed);
  // Set the next validator to already eth1 credential
  const withdrawalCredentialsTwo = digest(fromBlsPubkey);
  withdrawalCredentialsTwo[0] = ETH1_ADDRESS_WITHDRAWAL_PREFIX;
  const validatorTwo = ssz.phase0.Validator.toViewDU({
    pubkey: pubkey2,
    withdrawalCredentials: withdrawalCredentialsTwo,
    effectiveBalance: 32e9,
    slashed: false,
    activationEligibilityEpoch: 0,
    activationEpoch: 0,
    exitEpoch: FAR_FUTURE_EPOCH,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
  });
  stateEmpty.validators[1] = validatorTwo;

  // Generate the state
  const _state = generateState(stateEmpty, defaultConfig);
  const config = createBeaconConfig(defaultConfig, _state.genesisValidatorsRoot);
  const state = createCachedBeaconStateTest(_state, config);

  // Gen a valid blsToExecutionChange for first val
  const blsToExecutionChange = {
    validatorIndex: 0,
    fromBlsPubkey,
    toExecutionAddress: Buffer.alloc(20),
  };
  const signatureFork = ForkName.phase0;
  const domain = config.getDomainAtFork(signatureFork, DOMAIN_BLS_TO_EXECUTION_CHANGE);
  const signingRoot = computeSigningRoot(ssz.capella.BLSToExecutionChange, blsToExecutionChange, domain);
  const signedBlsToExecChange = {message: blsToExecutionChange, signature: wsk.sign(signingRoot).toBytes()};

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    opPool = sandbox.createStubInstance(OpPool) as OpPool & SinonStubbedInstance<OpPool>;
    (chainStub as {opPool: OpPool}).opPool = opPool;
    chainStub.getHeadState.returns(state);
    // TODO: Use actual BLS verification
    chainStub.bls = new BlsVerifierMock(true);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return invalid bls to execution Change - existing", async () => {
    const signedBlsToExecChangeInvalid: capella.SignedBLSToExecutionChange = {
      message: signedBlsToExecChange.message,
      signature: Buffer.alloc(96, 0),
    };

    // Return BlsToExecutionChange known
    opPool.hasSeenBlsToExecutionChange.returns(true);

    await expectRejectedWithLodestarError(
      validateBlsToExecutionChange(chainStub, signedBlsToExecChangeInvalid),
      BlsToExecutionChangeErrorCode.ALREADY_EXISTS
    );
  });

  it("should return valid blsToExecutionChange ", async () => {
    await validateBlsToExecutionChange(chainStub, signedBlsToExecChange);
  });

  it("should return invalid bls to execution Change - invalid validatorIndex", async () => {
    const signedBlsToExecChangeInvalid: capella.SignedBLSToExecutionChange = {
      message: {
        validatorIndex: 2,
        fromBlsPubkey: Buffer.alloc(48),
        toExecutionAddress: Buffer.alloc(20),
      },
      signature: Buffer.alloc(96, 0),
    };

    await expectRejectedWithLodestarError(
      validateBlsToExecutionChange(chainStub, signedBlsToExecChangeInvalid),
      BlsToExecutionChangeErrorCode.INVALID
    );
  });

  it("should return invalid bls to execution Change - already eth1", async () => {
    const signedBlsToExecChangeInvalid: capella.SignedBLSToExecutionChange = {
      message: {
        ...signedBlsToExecChange.message,
        validatorIndex: 1,
      },
      signature: Buffer.alloc(96, 0),
    };

    await expectRejectedWithLodestarError(
      validateBlsToExecutionChange(chainStub, signedBlsToExecChangeInvalid),
      BlsToExecutionChangeErrorCode.INVALID
    );
  });

  it("should return invalid bls to execution Change - invalid withdrawal credentials", async () => {
    const signedBlsToExecChangeInvalid: capella.SignedBLSToExecutionChange = {
      message: {
        validatorIndex: 1,
        fromBlsPubkey: Buffer.alloc(48),
        toExecutionAddress: Buffer.alloc(20),
      },
      signature: Buffer.alloc(96, 0),
    };

    await expectRejectedWithLodestarError(
      validateBlsToExecutionChange(chainStub, signedBlsToExecChangeInvalid),
      BlsToExecutionChangeErrorCode.INVALID
    );
  });

  it("should return invalid bls to execution Change - invalid fromBlsPubkey", async () => {
    const signedBlsToExecChangeInvalid: capella.SignedBLSToExecutionChange = {
      message: {
        validatorIndex: 0,
        fromBlsPubkey: Buffer.alloc(48, 1),
        toExecutionAddress: Buffer.alloc(20),
      },
      signature: Buffer.alloc(96, 0),
    };

    await expectRejectedWithLodestarError(
      validateBlsToExecutionChange(chainStub, signedBlsToExecChangeInvalid),
      BlsToExecutionChangeErrorCode.INVALID
    );
  });
});
