import {config} from "@chainsafe/lodestar-config/mainnet";
import {Vector} from "@chainsafe/persistent-ts";
import {BasicListType, List, ListType, TreeBacked} from "@chainsafe/ssz";
import {expect} from "chai";
import {decreaseBalance, increaseBalance, phase0, ZERO_HASH} from "../../../../src";
import {
  BeaconState,
  buildBalancesTree,
  buildBalancesTreeBigUint64Array,
  buildBalancesTreeGiantBigUint64Array,
  createCachedValidatorsBeaconState,
  Gwei,
} from "../../../../src/phase0";
import {generateState} from "../../../utils/state";

const NUM_VALIDATORS = 100000;

describe("Cache Validators", function () {
  let state: TreeBacked<phase0.BeaconState>;
  let wrappedState: phase0.fast.CachedValidatorsBeaconState;

  before(function () {
    this.timeout(0);
    const validators: phase0.Validator[] = [];
    for (let i = 0; i < NUM_VALIDATORS; i++) {
      validators.push({
        pubkey: Buffer.alloc(48),
        withdrawalCredentials: Buffer.alloc(32),
        effectiveBalance: BigInt(1000000),
        slashed: false,
        activationEligibilityEpoch: i + 10,
        activationEpoch: i,
        exitEpoch: i + 20,
        withdrawableEpoch: i + 30,
      });
    }
    const defaultState = generateState({validators: validators as List<phase0.Validator>});
    state = config.types.phase0.BeaconState.tree.createValue(defaultState);
  });

  beforeEach(() => {
    state = state.clone();
    wrappedState = phase0.fast.createCachedValidatorsBeaconState(state);
  });

  it("should read the same value of TreeBacked<BeaconState>", () => {
    expect(state.validators[1000].activationEpoch).to.be.equal(1000);
    expect(wrappedState.validators[1000].activationEpoch).to.be.equal(1000);
    expect(wrappedState.flatValidators().get(1000)!.activationEpoch).to.be.equal(1000);
  });

  it("should modify both state and wrappedState", () => {
    const oldFlatValidator = wrappedState.flatValidators().get(1000);
    wrappedState.updateValidator(1000, {activationEpoch: 2020, exitEpoch: 2030});
    expect(wrappedState.flatValidators().get(1000)!.activationEpoch).to.be.equal(2020);
    expect(wrappedState.flatValidators().get(1000)!.exitEpoch).to.be.equal(2030);
    // other property is the same
    expect(wrappedState.flatValidators().get(1000)!.effectiveBalance).to.be.equal(oldFlatValidator?.effectiveBalance);
    expect(wrappedState.flatValidators().get(1000)!.slashed).to.be.equal(oldFlatValidator?.slashed);
    expect(wrappedState.flatValidators().get(1000)!.activationEligibilityEpoch).to.be.equal(
      oldFlatValidator?.activationEligibilityEpoch
    );
    expect(wrappedState.flatValidators().get(1000)!.withdrawableEpoch).to.be.equal(oldFlatValidator?.withdrawableEpoch);

    expect(state.validators[1000].activationEpoch).to.be.equal(2020);
    expect(state.validators[1000].exitEpoch).to.be.equal(2030);
    // other property is the same
    expect(state.validators[1000].effectiveBalance).to.be.equal(oldFlatValidator?.effectiveBalance);
    expect(state.validators[1000].slashed).to.be.equal(oldFlatValidator?.slashed);
    expect(state.validators[1000].activationEligibilityEpoch).to.be.equal(oldFlatValidator?.activationEligibilityEpoch);
    expect(state.validators[1000].withdrawableEpoch).to.be.equal(oldFlatValidator?.withdrawableEpoch);
  });

  it("should add validator to both state and wrappedState", () => {
    wrappedState.addValidator({
      pubkey: Buffer.alloc(48),
      withdrawalCredentials: Buffer.alloc(32),
      effectiveBalance: BigInt(1000000),
      slashed: false,
      activationEligibilityEpoch: NUM_VALIDATORS + 10,
      activationEpoch: NUM_VALIDATORS,
      exitEpoch: NUM_VALIDATORS + 20,
      withdrawableEpoch: NUM_VALIDATORS + 30,
    });

    expect(wrappedState.flatValidators().length).to.be.equal(NUM_VALIDATORS + 1);
    expect(state.validators.length).to.be.equal(NUM_VALIDATORS + 1);
    expect(wrappedState.flatValidators().get(NUM_VALIDATORS)!.activationEpoch).to.be.equal(NUM_VALIDATORS);
    expect(state.validators[NUM_VALIDATORS].activationEpoch).to.be.equal(NUM_VALIDATORS);
  });
});

describe("Cache balances", function () {
  let state: BeaconState;
  let originalState: TreeBacked<phase0.BeaconState>;
  let cachedState: phase0.fast.CachedValidatorsBeaconState;
  const balances = [
    BigInt(31217089836),
    BigInt(31217089837),
    BigInt(31217089838),
    BigInt(31217089839),
    BigInt(31217089840),
  ];

  before(function () {
    const regularState = generateState({
      slot: 2021,
      balances: balances as List<Gwei>,
      finalizedCheckpoint: {root: ZERO_HASH, epoch: 10},
    });
    regularState.genesisTime = 1614651451;
    originalState = config.types.phase0.BeaconState.tree.createValue(regularState);
  });

  beforeEach(function () {
    state = originalState.clone();
    cachedState = createCachedValidatorsBeaconState(config.types.phase0.BeaconState.clone(state));
  });

  it("same balance", function () {
    let balances = cachedState.getBalances();
    expect(cachedState.getBalance(0)).to.be.equal(state.balances[0]);
    expect(cachedState.getBalance(1)).to.be.equal(state.balances[1]);
    expect(balances[0]).to.be.equal(state.balances[0]);
    expect(balances[1]).to.be.equal(state.balances[1]);
    increaseBalance(state, 0, BigInt(10000));
    cachedState.increaseBalance(0, 10000);
    decreaseBalance(state, 1, BigInt(20000));
    cachedState.decreaseBalance(1, 20000);
    balances = cachedState.getBalances();
    expect(cachedState.getBalance(0)).to.be.equal(state.balances[0]);
    expect(cachedState.getBalance(1)).to.be.equal(state.balances[1]);
    expect(balances[0]).to.be.equal(state.balances[0]);
    expect(balances[1]).to.be.equal(state.balances[1]);
    expect(state.balances[5]).to.be.undefined;
    state.balances.push(BigInt(2021));
    cachedState.addBalance(BigInt(2021));
    // last balance
    balances = cachedState.getBalances();
    expect(cachedState.getBalance(5)).to.be.equal(state.balances[5]);
    expect(balances[5]).to.be.equal(state.balances[5]);
    expect(config.types.phase0.BeaconState.equals(state, cachedState.getOriginalState())).to.be.true;
  });

  // failed bc we store chunks instead of balance
  it("same serialization", function () {
    let serialized1 = config.types.phase0.BeaconState.serialize(state);
    let serialized2 = config.types.phase0.BeaconState.serialize(cachedState.getOriginalState());
    expect(serialized1).to.be.deep.equal(serialized2);
    increaseBalance(state, 0, BigInt(10000));
    cachedState.increaseBalance(0, 10000);
    decreaseBalance(state, 4, BigInt(20000));
    cachedState.decreaseBalance(4, 20000);
    serialized1 = config.types.phase0.BeaconState.serialize(state);
    serialized2 = config.types.phase0.BeaconState.serialize(cachedState.getOriginalState());
    expect(serialized1).to.be.deep.equal(serialized2);
    state.balances.push(BigInt(2021));
    cachedState.addBalance(BigInt(2021));
    serialized1 = config.types.phase0.BeaconState.serialize(state);
    serialized2 = config.types.phase0.BeaconState.serialize(cachedState.getOriginalState());
    expect(serialized1).to.be.deep.equal(serialized2);
  });

  it("same hashTreeRoot", function () {
    expect(config.types.phase0.BeaconState.hashTreeRoot(cachedState.getOriginalState())).to.be.deep.equal(
      config.types.phase0.BeaconState.hashTreeRoot(state)
    );
    increaseBalance(state, 0, BigInt(10000));
    cachedState.increaseBalanceBigInt(0, BigInt(10000));
    decreaseBalance(state, 4, BigInt(20000));
    cachedState.decreaseBalanceBigInt(4, BigInt(20000));
    expect(config.types.phase0.BeaconState.hashTreeRoot(cachedState.getOriginalState())).to.be.deep.equal(
      config.types.phase0.BeaconState.hashTreeRoot(state)
    );
    state.balances.push(BigInt(100000));
    cachedState.addBalance(BigInt(100000));
    expect(config.types.phase0.BeaconState.hashTreeRoot(cachedState.getOriginalState())).to.be.deep.equal(
      config.types.phase0.BeaconState.hashTreeRoot(state)
    );
  });

  it("updateBalances", function () {
    for (let i = 0; i < balances.length; i++) {
      increaseBalance(state, i, BigInt(10000));
    }
    const rewards = Array.from({length: balances.length}, () => 10000);
    const penalties = Array.from({length: balances.length}, () => 0);
    cachedState.updateBalances(rewards, penalties);
    expect(config.types.phase0.BeaconState.hashTreeRoot(cachedState.getOriginalState())).to.be.deep.equal(
      config.types.phase0.BeaconState.hashTreeRoot(state)
    );
  });

  it("clone", function () {
    const cloned = cachedState.clone();
    const balance0 = cachedState.getBalance(0);
    cloned.increaseBalance(0, 10000);
    expect(cachedState.getBalance(0)).to.be.equal(balance0);
  });

  it("balancesBytes8Type vs BigIntUintType vs subTreeFillsToContent", function () {
    this.timeout(0);
    const balancesType = new ListType({
      elementType: config.types.Gwei,
      limit: config.params.VALIDATOR_REGISTRY_LIMIT,
    });
    const balancesBytes8Type = new BasicListType({
      elementType: config.types.Bytes8,
      limit: config.params.VALIDATOR_REGISTRY_LIMIT,
    });
    const newBalances = Array.from({length: 100000}, () => BigInt(31217089836));
    let start = Date.now();
    const balancesBigIntTree = balancesType.tree.createValue(newBalances);
    console.log("@@@ build balancesBigIntTree in", Date.now() - start);
    const newBalancesUint8Array = Array.from(newBalances).map((balance) => {
      const output = new Uint8Array(8);
      config.types.phase0.Gwei.toBytes(balance, output, 0);
      return output;
    });
    let uint8Chunk = new Uint8Array(32);
    let uint64Chunk = new BigUint64Array(4);
    let uint8Chunks: Vector<Uint8Array> = Vector.empty<Uint8Array>();
    let uint64Chunks: Vector<BigUint64Array> = Vector.empty<BigUint64Array>();
    const giantUint64Arr: BigUint64Array = new BigUint64Array(newBalances.length);
    for (let i = 0; i < newBalances.length; i++) {
      const balance = newBalances[i];
      if (i % 4 === 0) {
        uint8Chunk = new Uint8Array(32);
        uint64Chunk = new BigUint64Array(4);
      }
      config.types.phase0.Gwei.toBytes(balance, uint8Chunk, (i % 4) * 8);
      uint64Chunk[i % 4] = balance;
      if (i % 4 === 3 || i === newBalances.length - 1) {
        uint8Chunks = uint8Chunks.append(uint8Chunk);
        uint64Chunks = uint64Chunks.append(uint64Chunk);
      }
      giantUint64Arr[i] = balance;
    }

    start = Date.now();
    const balancesUint8ArrayTree = balancesBytes8Type.tree.createValue(newBalancesUint8Array);
    console.log("@@@ build balancesUint8ArrayTree - Vector<Uint8Array> in", Date.now() - start);
    expect(balancesBigIntTree.hashTreeRoot()).to.be.deep.equal(balancesUint8ArrayTree.hashTreeRoot());

    start = Date.now();
    const tree = buildBalancesTree(uint8Chunks, newBalances.length, config.params.VALIDATOR_REGISTRY_LIMIT);
    console.log("@@@ subTreeFillsToContent in", Date.now() - start);
    expect(tree.root).to.be.deep.equal(balancesUint8ArrayTree.hashTreeRoot());

    start = Date.now();
    const uint64Tree = buildBalancesTreeBigUint64Array(
      uint64Chunks,
      newBalances.length,
      config.params.VALIDATOR_REGISTRY_LIMIT
    );
    console.log("@@@ subTreeFillsToContent - Vector<BigUint64Array> in", Date.now() - start);
    expect(uint64Tree.root).to.be.deep.equal(balancesUint8ArrayTree.hashTreeRoot());

    start = Date.now();
    const giantUint64Tree = buildBalancesTreeGiantBigUint64Array(
      giantUint64Arr,
      config.params.VALIDATOR_REGISTRY_LIMIT
    );
    console.log("@@@ subTreeFillsToContent - Giant BigUint64Array in", Date.now() - start);
    expect(giantUint64Tree.root).to.be.deep.equal(balancesUint8ArrayTree.hashTreeRoot());
  });
});
