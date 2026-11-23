import assert from "node:assert/strict";
import fs from "node:fs";

const filename = process.argv[2] ?? "coverage/lcov.info";
const records = fs.readFileSync(filename, "utf8").split("end_of_record");
const executed = records.filter((record) => {
  const source = /^SF:(.+)$/m.exec(record)?.[1].trim().replaceAll("\\", "/");
  const linesHit = Number(/^LH:(\d+)$/m.exec(record)?.[1] ?? 0);
  return (
    source &&
    !/(?:^|\/)node_modules\//.test(source) &&
    /(?:^|\/)packages\/[^/]+\/src\/.+\.ts$/.test(source) &&
    linesHit > 0
  );
});
assert(executed.length > 0, `No executed package TypeScript source records in ${filename}`);
console.log(`Verified ${executed.length} executed package TypeScript coverage records`);
