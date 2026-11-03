import assert from "node:assert/strict";
import {Readable} from "node:stream";
import {test} from "node:test";
import {boundedLines} from "./bounded_lines.mjs";

test("bounded command input rejects an unterminated oversized line before EOF", async () => {
  let chunks = 0;
  const source = new Readable({
    highWaterMark: 16,
    read() {
      chunks++;
      this.push(Buffer.alloc(16, 97));
    },
  });
  await assert.rejects(boundedLines(source, 64).next(), /LineBound/);
  assert(chunks <= 6);
  source.destroy();
});

test("bounded command input backpressures complete lines while execution waits", async () => {
  let chunks = 0;
  const source = new Readable({
    highWaterMark: 16,
    read() {
      chunks++;
      this.push(Buffer.from("1\n2\n3\n4\n5\n6\n7\n8\n"));
    },
  });
  const lines = boundedLines(source, 64);
  assert.equal((await lines.next()).value, "1");
  await new Promise((resolve) => setImmediate(resolve));
  assert(chunks <= 2, "pending commands caused unbounded reads");
  assert.equal((await lines.next()).value, "2");
  await lines.return();
  source.destroy();
});
