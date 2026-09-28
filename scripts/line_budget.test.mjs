import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {evaluate, physicalLines} from "./line_budget.mjs";

const manifest = {
  exclude: [{category: "test", paths: ["**/*_test.zig"]}],
  frozen: false,
  modules: [
    {budget: 6, name: "core", paths: ["src/core/*.zig", "src/core/sub/**", "!src/core/io.zig"]},
    {budget: 4, name: "io", paths: ["src/io/**", "src/core/io.zig"]},
  ],
  reports: [{category: "tooling", paths: ["tools/**"]}],
  roots: ["src"],
};
const base = [
  {lines: 3, path: "src/core/a.zig"},
  {lines: 2, path: "src/core/b.zig"},
  {lines: 2, path: "src/core/io.zig"},
  {lines: 1, path: "src/core/sub/c.zig"},
  {lines: 2, path: "src/io/d.zig"},
  {lines: 40, path: "src/core/a_test.zig"},
  {lines: 5, path: "tools/run.mjs"},
  {lines: 9, path: "docs/readme.md"},
];

function codes(result) {
  return result.errors.map((error) => error.code);
}

function counts(result) {
  return Object.fromEntries(result.modules.map((module) => [module.name, module.lines]));
}

const replace = (files, from, to) => files.map((file) => (file.path === from ? {...file, path: to} : file));

test("physical lines count newlines and an unterminated last line", () => {
  assert.equal(physicalLines(Buffer.from("")), 0);
  assert.equal(physicalLines(Buffer.from("a\nb\n")), 2);
  assert.equal(physicalLines(Buffer.from("a\nb")), 2);
  assert.equal(physicalLines(Buffer.from("a\r\n\r\n")), 2);
});

test("the baseline aggregates modules and reports tests and tooling apart", () => {
  const result = evaluate(manifest, base);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(counts(result), {core: 6, io: 4});
  assert.deepEqual(result.categories, {test: {files: 1, lines: 40}, tooling: {files: 1, lines: 5}});
  assert.equal(result.largest[0].path, "src/core/a.zig");
});

const frozen = {...manifest, frozen: true};

function differences(result) {
  return result.differences.map((difference) => difference.code);
}

test("additions are reported while provisional and fail over a frozen budget, however they are split", () => {
  const grown = [...base, {lines: 1, path: "src/core/new.zig"}];
  const split = [...replace(base, "src/core/a.zig", "src/core/a1.zig"), {lines: 1, path: "src/core/a2.zig"}];
  for (const files of [grown, split]) {
    const provisional = evaluate(manifest, files);
    assert.deepEqual(codes(provisional), []);
    assert.deepEqual(provisional.differences, [{code: "OverBudget", detail: "core: 7 > 6"}]);
    assert.deepEqual(codes(evaluate(frozen, files)), ["OverBudget"]);
    assert.deepEqual(evaluate(frozen, files).differences, []);
  }
});

test("deletions are reported while provisional and demand a lower budget once frozen", () => {
  const shrunk = base.filter((file) => file.path !== "src/core/b.zig");
  assert.deepEqual(codes(evaluate(manifest, shrunk)), []);
  assert.deepEqual(differences(evaluate(manifest, shrunk)), ["LowerBudget"]);
  assert.deepEqual(codes(evaluate(frozen, shrunk)), ["LowerBudget"]);
  assert.deepEqual(codes(evaluate(frozen, base)), []);
  assert.deepEqual(differences(evaluate(manifest, base)), []);
});

test("moves keep a module's count within it and charge the destination across modules", () => {
  const within = replace(base, "src/core/a.zig", "src/core/sub/a.zig");
  assert.deepEqual(codes(evaluate(frozen, within)), []);
  assert.deepEqual(counts(evaluate(frozen, within)), {core: 6, io: 4});
  const across = replace(base, "src/core/b.zig", "src/io/b.zig");
  assert.deepEqual(counts(evaluate(manifest, across)), {core: 4, io: 6});
  assert.deepEqual(codes(evaluate(manifest, across)), []);
  assert.deepEqual(differences(evaluate(manifest, across)), ["LowerBudget", "OverBudget"]);
  assert.deepEqual(codes(evaluate(frozen, across)), ["LowerBudget", "OverBudget"]);
});

test("exclusions leave a module and are reported by category", () => {
  const renamed = replace(base, "src/core/b.zig", "src/core/b_test.zig");
  const result = evaluate(manifest, renamed);
  assert.deepEqual(counts(result), {core: 4, io: 4});
  assert.deepEqual(result.categories.test, {files: 2, lines: 42});
});

test("unknown, ambiguous and stale paths fail while budgets are provisional", () => {
  assert.deepEqual(codes(evaluate(manifest, [...base, {lines: 1, path: "src/new/e.zig"}])), ["Unclassified"]);
  const overlapping = {...manifest, modules: [...manifest.modules, {budget: 9, name: "all", paths: ["src/io/**"]}]};
  assert.deepEqual(codes(evaluate(overlapping, base)), ["Ambiguous", "StalePattern", "StalePattern"]);
  const stale = {...manifest, exclude: [{category: "test", paths: ["**/*_test.zig", "**/*_fixture.zig"]}]};
  assert.deepEqual(codes(evaluate(stale, base)), ["StalePattern"]);
  const unusedNegation = structuredClone(manifest);
  unusedNegation.modules[0].paths.push("!src/core/gone.zig");
  assert.deepEqual(codes(evaluate(unusedNegation, base)), ["StalePattern"]);
  assert.deepEqual(codes(evaluate({...manifest, roots: ["src", "lib"]}, base)), ["StaleRoot"]);
});

test("the command counts tracked files only and writes nothing", () => {
  const repository = mkdtempSync(join(tmpdir(), "line-budget-"));
  try {
    const script = fileURLToPath(new URL("./line_budget.mjs", import.meta.url));
    const write = (path, source) => {
      mkdirSync(dirname(join(repository, path)), {recursive: true});
      writeFileSync(join(repository, path), source);
    };
    mkdirSync(join(repository, "scripts"));
    copyFileSync(script, join(repository, "scripts", "line_budget.mjs"));
    write("scripts/line_budget.json", JSON.stringify({...manifest, reports: []}));
    for (const file of base.filter((file) => file.path.startsWith("src/"))) write(file.path, "x\n".repeat(file.lines));
    const git = (...args) => execFileSync("git", args, {cwd: repository, stdio: "pipe"});
    git("init", "-q");
    git("add", ".");
    write("src/core/untracked.zig", "x\n".repeat(100));
    const run = () => spawnSync(process.execPath, [join(repository, "scripts", "line_budget.mjs"), "check", "--json"]);
    const passed = run();
    assert.equal(passed.status, 0, passed.stderr.toString());
    assert.deepEqual(counts(JSON.parse(passed.stdout)), {core: 6, io: 4});
    write("src/io/d.zig", "x\n".repeat(3));
    const reported = run();
    assert.equal(reported.status, 0, reported.stderr.toString());
    assert.deepEqual(differences(JSON.parse(reported.stdout)), ["OverBudget"]);
    write("scripts/line_budget.json", JSON.stringify({...frozen, reports: []}));
    const status = git("status", "--porcelain", "--untracked-files=all").toString();
    const failed = run();
    assert.equal(failed.status, 1);
    assert.deepEqual(codes(JSON.parse(failed.stdout)), ["OverBudget"]);
    assert.equal(git("status", "--porcelain", "--untracked-files=all").toString(), status);
  } finally {
    rmSync(repository, {force: true, recursive: true});
  }
});
