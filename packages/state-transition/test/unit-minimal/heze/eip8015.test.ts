import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {Tree, toGindex} from "@chainsafe/persistent-merkle-tree";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {
  DEPOSIT_CONTRACT_TREE_DEPTH,
  DOMAIN_DEPOSIT,
  ForkName,
  SLOTS_PER_EPOCH,
  UNSET_DEPOSIT_REQUESTS_START_INDEX,
} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {ZERO_HASH} from "../../../src/constants/index.js";
import {upgradeStateToHeze} from "../../../src/slot/upgradeStateToHeze.js";
import {BeaconStateView} from "../../../src/stateView/beaconStateView.js";
import {createCachedBeaconStateTest} from "../../../src/testUtils/state.js";
import {CachedBeaconStateGloas, CachedBeaconStateHeze} from "../../../src/types.js";
import {applyDeposits, getGenesisBeaconState, initializeBeaconStateFromEth1} from "../../../src/util/genesis.js";
import {computeDomain, computeSigningRoot} from "../../../src/util/index.js";
import {interopSecretKey} from "../../../src/util/interop.js";

const config = getConfig(ForkName.heze, 1);

/** Deposit data with a valid proof-of-possession for interop key `index` and 0x01 credentials. */
function buildDepositData(index: number): phase0.DepositData {
  const secretKey = interopSecretKey(index);
  const pubkey = secretKey.toPublicKey().toBytes();
  const withdrawalCredentials = new Uint8Array(32).fill(index + 1);
  withdrawalCredentials[0] = 0x01;
  const depositMessage = {pubkey, withdrawalCredentials, amount: 32e9};
  const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);
  const signingRoot = computeSigningRoot(ssz.phase0.DepositMessage, depositMessage, domain);
  return {...depositMessage, signature: secretKey.sign(signingRoot).toBytes()};
}

function buildGloasState(): CachedBeaconStateGloas {
  const state = ssz.gloas.BeaconState.defaultViewDU();
  state.slot = 1;
  state.fork.currentVersion = config.GLOAS_FORK_VERSION;
  state.eth1DepositIndex = 7;
  state.depositRequestsStartIndex = 7n;
  return createCachedBeaconStateTest(state, config, {skipSyncCommitteeCache: true});
}

describe("Heze EIP-8015 state transition", () => {
  for (const startIndex of [6n, 8n, UNSET_DEPOSIT_REQUESTS_START_INDEX]) {
    it(`upgradeStateToHeze rejects a pending legacy deposit transition (start index ${startIndex})`, () => {
      const pre = buildGloasState();
      pre.depositRequestsStartIndex = startIndex;
      const node = pre.node;
      expect(() => upgradeStateToHeze(pre)).toThrow("legacy deposit mechanism");
      expect(pre.node).toBe(node);
      expect(pre.depositRequestsStartIndex).toBe(startIndex);
      expect(pre.fork.currentVersion).toEqual(config.GLOAS_FORK_VERSION);
    });
  }

  it("BeaconStateView.eth1Data throws for Heze states", () => {
    const pre = buildGloasState();
    expect(new BeaconStateView(pre).eth1Data).toEqual(pre.eth1Data);
    const heze = ssz.heze.BeaconState.defaultViewDU();
    heze.slot = SLOTS_PER_EPOCH;
    heze.fork.currentVersion = config.HEZE_FORK_VERSION;
    const post = createCachedBeaconStateTest(heze, config, {skipSyncCommitteeCache: true}) as CachedBeaconStateHeze;
    expect(() => new BeaconStateView(post).eth1Data).toThrow("removed");
  });
});

describe("Heze EIP-8015 genesis", () => {
  const hezeConfig = getConfig(ForkName.heze);
  const beaconConfig = createBeaconConfig(hezeConfig, ZERO_HASH);

  function buildDeposit(index: number): phase0.Deposit {
    return {
      proof: Array.from({length: DEPOSIT_CONTRACT_TREE_DEPTH + 1}, () => ZERO_HASH),
      data: buildDepositData(index),
    };
  }

  function buildDepositsWithProofs(count: number): phase0.Deposit[] {
    const depositDataRootList = ssz.phase0.DepositDataRootList.defaultViewDU();
    const deposits: phase0.Deposit[] = [];
    for (let i = 0; i < count; i++) {
      const data = buildDepositData(i);
      depositDataRootList.push(ssz.phase0.DepositData.hashTreeRoot(data));
      depositDataRootList.commit();
      const proof = new Tree(depositDataRootList.node).getSingleProof(
        toGindex(depositDataRootList.type.depth, BigInt(i))
      );
      deposits.push({proof, data});
    }
    return deposits;
  }

  it("getGenesisBeaconState seeds randao without creating eth1Data", () => {
    const eth1Data = ssz.phase0.Eth1Data.defaultValue();
    eth1Data.blockHash.fill(3);
    const state = getGenesisBeaconState(hezeConfig, eth1Data, ssz.phase0.BeaconBlockHeader.defaultValue());
    expect(state.randaoMixes.get(0)).toEqual(eth1Data.blockHash);
    expect(Object.hasOwn(state, "eth1Data")).toBe(false);
    expect(Object.hasOwn(state.toValue(), "eth1Data")).toBe(false);
  });

  it("applyDeposits onboards validators without a deposit tree", () => {
    const state = createCachedBeaconStateTest(
      getGenesisBeaconState(
        hezeConfig,
        ssz.phase0.Eth1Data.defaultValue(),
        ssz.phase0.BeaconBlockHeader.defaultValue()
      ),
      hezeConfig,
      {skipSyncCommitteeCache: true, skipSyncPubkeys: true}
    ) as CachedBeaconStateHeze;
    const {activatedValidatorCount} = applyDeposits(hezeConfig, state, [buildDeposit(0), buildDeposit(1)]);
    expect(activatedValidatorCount).toBe(2);
    expect(state.validators.length).toBe(2);
    expect(state.balances.getAll()).toEqual([32e9, 32e9]);
    expect(state.pendingDeposits.length).toBe(0);
  });

  it("initializeBeaconStateFromEth1 builds a Heze genesis state", () => {
    const blockHash = new Uint8Array(32).fill(4);
    const state = initializeBeaconStateFromEth1(hezeConfig, {config: beaconConfig, pubkeyCache}, blockHash, 0, [
      buildDeposit(0),
    ]);
    expect(state.validators.length).toBe(1);
    expect(state.randaoMixes.get(0)).toEqual(blockHash);
    expect(state.fork.currentVersion).toEqual(hezeConfig.HEZE_FORK_VERSION);
    for (const field of ["eth1Data", "eth1DataVotes", "eth1DepositIndex", "depositRequestsStartIndex"]) {
      expect(Object.hasOwn(state, field), field).toBe(false);
      expect(Object.hasOwn(state.toValue(), field), field).toBe(false);
    }
  });

  it("initializeBeaconStateFromEth1 at a Gloas genesis closes the legacy deposit queue for the Heze upgrade", () => {
    const gloasConfig = getConfig(ForkName.gloas);
    const state = initializeBeaconStateFromEth1(
      gloasConfig,
      {config: createBeaconConfig(gloasConfig, ZERO_HASH), pubkeyCache},
      new Uint8Array(32).fill(5),
      0,
      buildDepositsWithProofs(2)
    ) as CachedBeaconStateGloas;
    expect(state.eth1DepositIndex).toBe(2);
    expect(state.depositRequestsStartIndex).toBe(2n);
    expect(() => upgradeStateToHeze(state)).not.toThrow();
  });
});
