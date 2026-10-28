import {type PubkeyCache, pubkeyCache as nativePubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {ChainForkConfig, createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {
  BeaconStateAllForks,
  BeaconStateAltair,
  BeaconStateCache,
  createCachedBeaconState,
  createEmptyEpochCacheImmutableData,
  getSyncCommitteeCache,
} from "@lodestar/state-transition";
import {LenientPubkeyCache} from "./lenientPubkeyCache.js";

export type CreateCachedBeaconStateTestOpts = {
  /**
   * Accept fixture states whose validator pubkeys are not valid BLS points and whose sync committees list
   * pubkeys of no validator (the EIP-8453 compliance suite). Unknown sync committee members map to an index
   * that would throw if a block ever credited them.
   */
  lenient?: boolean;
};

export function createCachedBeaconStateTest<T extends BeaconStateAllForks>(
  state: T,
  chainConfig: ChainForkConfig,
  opts: CreateCachedBeaconStateTestOpts = {}
): T & BeaconStateCache {
  if (!opts.lenient) {
    return createCachedBeaconState<T>(state, createEmptyEpochCacheImmutableData(chainConfig, state));
  }

  // Signature verification reads the process-wide native cache, so fill it when the fixture keys are real BLS
  // points and fall back to a lenient cache only for placeholder keys (those fixtures verify no signatures)
  let pubkeyCache: PubkeyCache = nativePubkeyCache;
  try {
    nativePubkeyCache.syncPubkeys(state.validators.getAllReadonlyValues());
  } catch (_e) {
    nativePubkeyCache.reset();
    pubkeyCache = new LenientPubkeyCache();
  }
  // The generator's hand-built states keep `fork.current_version = 0x00000000`, and the pyspec signs with the
  // version in the state, while Lodestar derives domains from its fork schedule: take the version from the state
  const fixtureConfig =
    chainConfig.getForkSeq(state.slot) >= ForkSeq.eip8453
      ? createChainForkConfig({...chainConfig, EIP8453_FORK_VERSION: state.fork.currentVersion})
      : chainConfig;
  const cachedState = createCachedBeaconState<T>(
    state,
    {config: createBeaconConfig(fixtureConfig, state.genesisValidatorsRoot), pubkeyCache},
    {skipSyncCommitteeCache: true}
  );
  if (chainConfig.getForkSeq(state.slot) >= ForkSeq.altair) {
    const altairState = state as BeaconStateAltair;
    const toIndices = (pubkeys: Uint8Array[]): Uint32Array =>
      new Uint32Array(pubkeys.map((pubkey) => pubkeyCache.getIndex(pubkey) ?? 0xffffffff));
    cachedState.epochCtx.currentSyncCommitteeIndexed = getSyncCommitteeCache(
      toIndices(altairState.currentSyncCommittee.pubkeys.getAllReadonly())
    );
    cachedState.epochCtx.nextSyncCommitteeIndexed = getSyncCommitteeCache(
      toIndices(altairState.nextSyncCommittee.pubkeys.getAllReadonly())
    );
  }
  return cachedState;
}
