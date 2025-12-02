const wordPattern = new RegExp(["[A-Z][a-z]+", "[A-Z]+(?=[A-Z][a-z])", "[A-Z]+", "[a-z]+", "[0-9]+"].join("|"), "g");
function splitString(str: string): string[] {
  const normalized = str
    // sanitize characters that cannot be included
    .replace(/[!@#$%^&*]/g, "-")
    // normalize separators to '-'
    .replace(/[._/\s\\]/g, "-")
    .split("-");
  return normalized.map((seg) => seg.match(wordPattern) || []).flat();
}
function capitalizeFirstLetter(segment: string): string {
  return segment[0].toUpperCase() + segment.slice(1);
}
function lowercaseFirstLetter(segment: string): string {
  return segment[0].toLowerCase() + segment.slice(1);
}
function toKebab(str: string): string {
  return splitString(str).join("-").toLowerCase();
}
function toPascal(str: string): string {
  return splitString(str).map(capitalizeFirstLetter).join("");
}
function toCamel(str: string): string {
  return lowercaseFirstLetter(toPascal(str));
}
function toEnv(str: string): string {
  return splitString(str).join("_").toUpperCase();
}
export {capitalizeFirstLetter, toKebab, toCamel, toPascal, toEnv};
