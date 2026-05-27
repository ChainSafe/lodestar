import {BuddyState, Mood, RareSprite, SpriteKind} from "./types.js";

const SLOTS_PER_EPOCH = 32;
const REORG_LOOKBACK_SLOTS = 32;
const SYNC_LAG_THRESHOLD_SLOTS = 32;
const RARE_SLOTS = new Set([1337, 31337]);
const MILLION = 1_000_000;

export type Telemetry = {
  slot: number;
  peers: number;
  isSyncing: boolean;
  syncDistance: number;
  fork: string;
  prevFork: string;
  lastReorgSlot: number | null;
};

export function computeMood(t: Telemetry): Mood {
  if (t.peers === 0) return Mood.panic;
  if (t.lastReorgSlot !== null && t.slot - t.lastReorgSlot <= REORG_LOOKBACK_SLOTS) return Mood.sad;
  if (t.isSyncing && t.syncDistance > SYNC_LAG_THRESHOLD_SLOTS) return Mood.sleepy;
  return Mood.happy;
}

export function computeRare(t: Telemetry): {rare: RareSprite; label?: string} | null {
  if (RARE_SLOTS.has(t.slot)) {
    return {rare: t.slot === 1337 ? RareSprite.slot1337 : RareSprite.slot31337, label: `slot ${t.slot}`};
  }
  if (t.slot >= MILLION && t.slot % MILLION === 0) {
    return {rare: RareSprite.slotMillion, label: `${t.slot / MILLION}M`};
  }
  if (t.fork !== t.prevFork) {
    return {rare: RareSprite.forkActivation, label: t.fork};
  }
  return null;
}

export function buildState(t: Telemetry): BuddyState {
  return {
    slot: t.slot,
    epoch: Math.floor(t.slot / SLOTS_PER_EPOCH),
    fork: t.fork,
    peers: t.peers,
    synced: !t.isSyncing,
    syncDistance: t.syncDistance,
    mood: computeMood(t),
    override: computeRare(t) ?? undefined,
  };
}

export function spriteKindFor(state: BuddyState): SpriteKind {
  if (state.override) return {kind: "rare", rare: state.override.rare, label: state.override.label};
  return {kind: "mood", mood: state.mood};
}
