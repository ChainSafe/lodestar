import assert from "node:assert/strict";

export async function* boundedLines(source, limit = 65536) {
  assert(Number.isInteger(limit) && limit > 0 && limit <= 65536);
  const carry = Buffer.alloc(limit);
  let used = 0;
  for await (const chunk of source) {
    assert(Buffer.isBuffer(chunk), "binary command input required");
    for (const byte of chunk) {
      if (byte === 10) {
        yield carry.subarray(0, used).toString("utf8");
        used = 0;
      } else {
        assert(used < limit, "LineBound");
        carry[used++] = byte;
      }
    }
  }
  assert.equal(used, 0, "unterminated command");
}
