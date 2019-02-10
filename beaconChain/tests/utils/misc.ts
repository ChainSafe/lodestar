/**
 * Renerates a random integer between min (included) and max (excluded).
 */
export function randBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}
