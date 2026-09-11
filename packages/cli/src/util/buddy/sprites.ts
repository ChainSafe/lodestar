import {Mood, SpriteKind} from "./types.js";

export const SPRITE_HEIGHT = 4;

type Face = {eyes: string; mouth: string};

const FACES: Record<Mood, Face> = {
  [Mood.happy]: {eyes: "^ ^", mouth: "\\_/"},
  [Mood.sleepy]: {eyes: "- -", mouth: "___"},
  [Mood.panic]: {eyes: "O O", mouth: "/~\\"},
  [Mood.sad]: {eyes: "; ;", mouth: "/-\\"},
};

function renderMood(mood: Mood): string[] {
  const {eyes, mouth} = FACES[mood];
  return ["  .---.   ", ` / ${eyes} \\  `, ` \\ ${mouth} /  `, "  '---'   "];
}

const STARBURST: string[] = ["  \\ | /   ", " --*--*-- ", "  / | \\   ", "          "];

function renderRare(label?: string): string[] {
  const base = STARBURST.slice();
  if (label) {
    base[3] = `  ${label.slice(0, 8).padEnd(8, " ")}`;
  }
  return base;
}

export function renderSprite(kind: SpriteKind): string[] {
  if (kind.kind === "mood") return renderMood(kind.mood);
  return renderRare(kind.label);
}
