import {describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {ChainEvent, ChainEventEmitter, PublishDataColumnsEventData} from "../../../src/chain/emitter.js";
import {emitPublishedDataColumns} from "../../../src/chain/publishDataColumns.js";

function createSidecar(index: number) {
  const sidecar = ssz.fulu.DataColumnSidecar.defaultValue();
  sidecar.index = index;
  sidecar.signedBlockHeader.message.slot = 1;
  return sidecar;
}

describe("emitPublishedDataColumns", () => {
  it("should emit full-only data column publishes without enabling partial dissemination", () => {
    const emitter = new ChainEventEmitter();
    const published: PublishDataColumnsEventData[] = [];
    const sidecars = [createSidecar(0)];
    emitter.on(ChainEvent.publishDataColumns, (data) => published.push(data));

    emitPublishedDataColumns(emitter, sidecars);

    expect(published).toEqual([{columns: sidecars, publishPartial: false, partialTrigger: undefined}]);
  });

  it("should emit source-aware partial dissemination triggers for execution and recovery", () => {
    const emitter = new ChainEventEmitter();
    const published: PublishDataColumnsEventData[] = [];
    const sidecars = [createSidecar(1)];
    emitter.on(ChainEvent.publishDataColumns, (data) => published.push(data));

    emitPublishedDataColumns(emitter, sidecars, "post_getblobs");
    emitPublishedDataColumns(emitter, sidecars, "recovery");

    expect(published).toEqual([
      {columns: sidecars, publishPartial: true, partialTrigger: "post_getblobs"},
      {columns: sidecars, publishPartial: true, partialTrigger: "recovery"},
    ]);
  });
});
