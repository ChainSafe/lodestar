import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import type {PubkeyCache} from "@lodestar/native/pubkeys";
import {ForkName, ForkSeq} from "@lodestar/params";
import {toHex} from "@lodestar/utils";
import {addValidatorToRegistry} from "../../../src/block/processDeposit.js";
import {createCachedBeaconState} from "../../../src/cache/stateCache.js";
import {BeaconStateView} from "../../../src/stateView/beaconStateView.js";
import {BeaconStateElectra, CachedBeaconStateElectra} from "../../../src/types.js";
import {promoteFinalizedPubkeys} from "../../../src/util/validator.js";
import {generateState} from "../../utils/state.js";

/** Dense in-memory cache, so each test starts from a finalized prefix equal to its anchor state */
function createTestPubkeyCache(): PubkeyCache {
  const pubkeys: Uint8Array[] = [];
  const indices = new Map<string, number>();
  const unsupported = (): never => {
    throw Error("not used by this test");
  };
  const cache: PubkeyCache = {
    get: unsupported,
    getOrThrow: unsupported,
    getPubkeyBytes: (index) => pubkeys[index],
    getPubkeyBytesOrThrow: unsupported,
    aggregate: unsupported,
    getIndex: (pubkey) => indices.get(toHex(pubkey)) ?? null,
    append(index, pubkey) {
      if (index !== pubkeys.length) throw Error(`sparse append at ${index}`);
      pubkeys.push(pubkey);
      indices.set(toHex(pubkey), index);
    },
    syncPubkeys(validators) {
      for (let i = pubkeys.length; i < validators.length; i++) cache.append(i, validators[i].pubkey);
    },
    get size() {
      return pubkeys.length;
    },
    get capacity() {
      return pubkeys.length;
    },
    load: unsupported,
    reset: unsupported,
    save: unsupported,
    ensureCapacity: () => {},
  };
  return cache;
}

function createAnchor(pubkeyCache: PubkeyCache): CachedBeaconStateElectra {
  const config = getConfig(ForkName.electra, 0);
  const state = generateState(undefined, config) as BeaconStateElectra;
  return createCachedBeaconState(state, {config: createBeaconConfig(config, state.genesisValidatorsRoot), pubkeyCache});
}

const pubkeyP = new Uint8Array(48).fill(0xb0);
const pubkeyQ = new Uint8Array(48).fill(0x01);
const credentials = new Uint8Array(32).fill(0x01);

describe("finalized-only pubkey cache", () => {
  it("keeps a side branch validator out of a sibling branch at the same index", () => {
    const pubkeyCache = createTestPubkeyCache();
    const anchor = createAnchor(pubkeyCache);
    const finalizedCount = pubkeyCache.size;
    const branchA = anchor.clone();
    const branchB = anchor.clone();

    addValidatorToRegistry(ForkSeq.electra, branchA, pubkeyP, credentials, 0);
    addValidatorToRegistry(ForkSeq.electra, branchB, pubkeyQ, credentials, 0);

    expect(pubkeyCache.size).toBe(finalizedCount);
    expect(branchA.epochCtx.getValidatorIndex(branchA, pubkeyP)).toBe(finalizedCount);
    expect(branchB.epochCtx.getValidatorIndex(branchB, pubkeyQ)).toBe(finalizedCount);
    expect(branchB.epochCtx.getValidatorIndex(branchB, pubkeyP)).toBeNull();
    expect(branchA.epochCtx.getValidatorIndex(branchA, pubkeyQ)).toBeNull();
  });

  it("indexes later validators per state without sharing them with clones", () => {
    const pubkeyCache = createTestPubkeyCache();
    const state = createAnchor(pubkeyCache).clone();
    const finalizedCount = pubkeyCache.size;

    expect(state.epochCtx.getValidatorIndex(state, pubkeyP)).toBeNull();
    addValidatorToRegistry(ForkSeq.electra, state, pubkeyP, credentials, 0);
    expect(state.epochCtx.getValidatorIndex(state, pubkeyP)).toBe(finalizedCount);

    state.commit();
    const child = state.clone();
    addValidatorToRegistry(ForkSeq.electra, child, pubkeyQ, credentials, 0);
    expect(child.epochCtx.getValidatorIndex(child, pubkeyP)).toBe(finalizedCount);
    expect(child.epochCtx.getValidatorIndex(child, pubkeyQ)).toBe(finalizedCount + 1);
    expect(state.epochCtx.getValidatorIndex(state, pubkeyQ)).toBeNull();
  });

  it("promotes a validator once its activation eligibility is finalized", () => {
    const pubkeyCache = createTestPubkeyCache();
    const anchor = createAnchor(pubkeyCache);
    const finalizedCount = pubkeyCache.size;
    const state = anchor.clone();
    addValidatorToRegistry(ForkSeq.electra, state, pubkeyP, credentials, 0);
    state.validators.get(finalizedCount).activationEligibilityEpoch = 5;

    state.finalizedCheckpoint.epoch = 4;
    state.commit();
    promoteFinalizedPubkeys(pubkeyCache, new BeaconStateView(state));
    expect(pubkeyCache.size).toBe(finalizedCount);

    state.finalizedCheckpoint.epoch = 5;
    state.commit();
    promoteFinalizedPubkeys(pubkeyCache, new BeaconStateView(state));
    expect(pubkeyCache.size).toBe(finalizedCount + 1);
    expect(pubkeyCache.getIndex(pubkeyP)).toBe(finalizedCount);
  });
});
