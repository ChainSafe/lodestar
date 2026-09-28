import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {join, matchesGlob, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

// Holds tracked production source to reviewed per-module line budgets. It counts physical lines, comments and inline
// tests included, of every tracked file under the manifest's roots. Reviewed rules exclude dedicated tests, fixtures
// and other non-production files, and each remaining file belongs to exactly one module, so splitting or moving files
// cannot evade a module's cap. Budget differences fail only once the manifest is frozen; until then they are reported.
// Test and tooling sizes are reported, never budgeted. Nothing is built or written.

const MANIFEST = "scripts/line_budget.json";
const MAX_TRACKED_FILES = 1_000_000;
const LARGEST_FILES = 10;

export function physicalLines(bytes) {
  let lines = 0;
  for (const byte of bytes) if (byte === 0x0a) lines++;
  return bytes.length > 0 && bytes.at(-1) !== 0x0a ? lines + 1 : lines;
}

function under(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

/** A path list matches when a pattern does and no `!`-prefixed pattern of the same list does. */
function matches(patterns, path) {
  let matched = false;
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      if (matchesGlob(path, pattern.slice(1))) return false;
    } else if (matchesGlob(path, pattern)) matched = true;
  }
  return matched;
}

function validate(manifest) {
  const errors = [];
  if (typeof manifest.frozen !== "boolean") errors.push({code: "InvalidManifest", detail: "frozen"});
  const names = new Set();
  for (const module of manifest.modules ?? []) {
    if (names.has(module.name)) errors.push({code: "DuplicateModule", detail: module.name});
    names.add(module.name);
    if (!Number.isSafeInteger(module.budget) || module.budget < 0) {
      errors.push({code: "InvalidBudget", detail: module.name});
    }
  }
  if (names.size === 0 || !Array.isArray(manifest.roots) || manifest.roots.length === 0) {
    errors.push({code: "InvalidManifest", detail: "roots and modules are required"});
  }
  return errors;
}

/**
 * Evaluates `files`, each `{path, lines}` with a repository-relative POSIX path, against `manifest`. Returns the
 * per-module counts, the excluded and reported sizes by category, and every error.
 */
export function evaluate(manifest, files) {
  const errors = validate(manifest);
  const modules = new Map((manifest.modules ?? []).map((module) => [module.name, {...module, files: [], lines: 0}]));
  const categories = new Map();
  const addCategory = (category, file) => {
    const entry = categories.get(category) ?? {files: 0, lines: 0};
    entry.files++;
    entry.lines += file.lines;
    categories.set(category, entry);
  };
  const inRoots = (path) => (manifest.roots ?? []).some((root) => under(path, root));
  const covered = files.filter((file) => inRoots(file.path));
  const outside = files.filter((file) => !inRoots(file.path));
  for (const root of manifest.roots ?? []) {
    if (!files.some((file) => under(file.path, root))) errors.push({code: "StaleRoot", detail: root});
  }
  for (const file of outside) {
    const report = (manifest.reports ?? []).find((group) => matches(group.paths, file.path));
    if (report !== undefined) addCategory(report.category, file);
  }
  for (const file of covered) {
    const exclusion = (manifest.exclude ?? []).find((rule) => matches(rule.paths, file.path));
    if (exclusion !== undefined) {
      addCategory(exclusion.category, file);
      continue;
    }
    const owners = [...modules.values()].filter((module) => matches(module.paths, file.path));
    if (owners.length === 0) errors.push({code: "Unclassified", detail: file.path});
    else if (owners.length > 1) {
      errors.push({code: "Ambiguous", detail: `${file.path}: ${owners.map((module) => module.name).join(", ")}`});
    } else {
      const [owner] = owners;
      owner.files.push(file);
      owner.lines += file.lines;
    }
  }
  // Every rule must still select something, so the manifest stays exactly as large as the tree needs.
  const stale = (owner, pattern, candidates) => {
    if (!candidates.some((file) => matchesGlob(file.path, pattern))) {
      errors.push({code: "StalePattern", detail: `${owner}: ${pattern}`});
    }
  };
  for (const rule of manifest.exclude ?? []) for (const pattern of rule.paths) stale(rule.category, pattern, covered);
  for (const group of manifest.reports ?? [])
    for (const pattern of group.paths) stale(group.category, pattern, outside);
  for (const module of modules.values()) {
    const selected = covered.filter((file) =>
      module.paths.some((p) => !p.startsWith("!") && matchesGlob(file.path, p))
    );
    for (const pattern of module.paths) {
      if (pattern.startsWith("!")) stale(module.name, pattern.slice(1), selected);
      else stale(module.name, pattern, module.files);
    }
  }
  const differences = [];
  for (const module of modules.values()) {
    if (module.lines === module.budget) continue;
    const over = module.lines > module.budget;
    const detail = `${module.name}: ${module.lines} ${over ? ">" : "<"} ${module.budget}`;
    (manifest.frozen ? errors : differences).push({code: over ? "OverBudget" : "LowerBudget", detail});
  }
  const budgeted = [...modules.values()].flatMap((module) =>
    module.files.map((file) => ({...file, module: module.name}))
  );
  return {
    categories: Object.fromEntries([...categories].sort(([left], [right]) => left.localeCompare(right))),
    differences,
    errors,
    frozen: manifest.frozen,
    largest: budgeted.sort((left, right) => right.lines - left.lines).slice(0, LARGEST_FILES),
    modules: [...modules.values()].map(({budget, files, lines, name}) => ({budget, files: files.length, lines, name})),
  };
}

/** Line counts of the tracked files `evaluate` needs: those under a root or in a report group. */
export function trackedFiles(repository, manifest) {
  const listed = execFileSync("git", ["ls-files", "-z"], {cwd: repository, maxBuffer: 256 * 1024 * 1024});
  const paths = listed.toString("utf8").split("\0").filter(Boolean);
  if (paths.length > MAX_TRACKED_FILES) throw Error("tracked file bound");
  const wanted = (path) =>
    manifest.roots.some((root) => under(path, root)) ||
    (manifest.reports ?? []).some((group) => matches(group.paths, path));
  return paths
    .filter(wanted)
    .map((path) => ({lines: physicalLines(readFileSync(join(repository, path))), path}))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function format(result) {
  const lines = [`line budget${result.frozen ? "" : " (provisional budgets, not frozen)"}`];
  const width = Math.max(...result.modules.map((module) => module.name.length));
  lines.push(`${"module".padEnd(width)}  ${"lines".padStart(7)}  ${"budget".padStart(7)}  files`);
  for (const module of result.modules) {
    lines.push(
      `${module.name.padEnd(width)}  ${String(module.lines).padStart(7)}  ${String(module.budget).padStart(7)}  ${module.files}`
    );
  }
  lines.push("not budgeted");
  for (const [category, entry] of Object.entries(result.categories)) {
    lines.push(`${category.padEnd(width)}  ${String(entry.lines).padStart(7)}  ${"".padStart(7)}  ${entry.files}`);
  }
  lines.push("largest budgeted files");
  for (const file of result.largest) lines.push(`${String(file.lines).padStart(7)}  ${file.path} (${file.module})`);
  for (const difference of result.differences) lines.push(`budget ${difference.code}: ${difference.detail}`);
  for (const error of result.errors) lines.push(`error ${error.code}: ${error.detail}`);
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args[0] !== "check" || args.slice(1).some((arg) => arg !== "--json")) {
    throw Error("usage: line_budget.mjs check [--json]");
  }
  const repository = fileURLToPath(new URL("../", import.meta.url));
  const manifest = JSON.parse(readFileSync(join(repository, MANIFEST), "utf8"));
  const result = evaluate(manifest, trackedFiles(repository, manifest));
  process.stdout.write(args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : format(result));
  if (result.errors.length !== 0) process.exitCode = 1;
}
