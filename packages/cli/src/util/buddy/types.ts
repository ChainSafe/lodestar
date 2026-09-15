export enum Mood {
  happy = "happy",
  sleepy = "sleepy",
  panic = "panic",
  sad = "sad",
}

export enum RareSprite {
  slot1337 = "slot1337",
  slot31337 = "slot31337",
  slotMillion = "slotMillion",
  forkActivation = "forkActivation",
}

export type SpriteKind = {kind: "mood"; mood: Mood} | {kind: "rare"; rare: RareSprite; label?: string};

export type BuddyMode = "off" | "file" | "tty" | "both";

export type BuddyState = {
  slot: number;
  epoch: number;
  fork: string;
  peers: number;
  synced: boolean;
  syncDistance: number;
  mood: Mood;
  override?: {rare: RareSprite; label?: string};
};
