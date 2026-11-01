import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {ssz} from "@lodestar/types";
import {metadata, sequence, status, uint64} from "./control_wire.mjs";

const fixture = JSON.parse(await readFile(new URL("control-wire-vectors.json", import.meta.url), "utf8"));
test("independent control layouts match pinned serializer fixtures and public Lodestar serializers", () => {
  assert.equal(fixture.records.length, 11);
  for (const record of fixture.records) {
    let actual;
    let schema;
    if (record.name.startsWith("status-")) {
      const version = Number(record.name.at(-1));
      actual = status(version);
      schema = version === 1 ? ssz.phase0.Status : ssz.fulu.Status;
    } else if (record.name.startsWith("metadata-")) {
      const version = Number(record.name.at(-1));
      actual = metadata(version);
      schema = [ssz.phase0.Metadata, ssz.altair.Metadata, ssz.fulu.Metadata][version - 1];
    } else {
      actual = uint64(BigInt(record.value));
      schema = record.name.startsWith("ping") ? ssz.phase0.Ping : ssz.phase0.Goodbye;
    }
    assert.equal(actual.length, record.length, record.name);
    assert.equal(actual.toString("hex"), record.hex, record.name);
    assert.equal(Buffer.from(schema.serialize(schema.fromJson(record.value))).toString("hex"), record.hex, record.name);
  }
  assert(sequence > BigInt(Number.MAX_SAFE_INTEGER));
});

test("empty Metadata reader accepts FIN received before handler attachment", async () => {
  const {readEmptyRequest} = await import("./control_handler.mjs");
  const stream = Object.assign(new EventTarget(), {
    readBufferLength: 0,
    remoteWriteStatus: "closed",
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          throw Error("iterator missed prior FIN");
        },
      };
    },
  });
  await readEmptyRequest(stream);
  stream.readBufferLength = 1;
  await assert.rejects(readEmptyRequest(stream), /Metadata must have no encoded request body/);
});

test("empty Metadata reader handles later FIN and rejects later content", async () => {
  const {readEmptyRequest} = await import("./control_handler.mjs");
  for (const invalid of [false, true]) {
    const stream = Object.assign(new EventTarget(), {readBufferLength: 0, remoteWriteStatus: "writable"});
    const result = readEmptyRequest(stream);
    stream.dispatchEvent(new Event(invalid ? "message" : "remoteCloseWrite"));
    if (invalid) await assert.rejects(result, /Metadata must have no encoded request body/);
    else await result;
  }
});
