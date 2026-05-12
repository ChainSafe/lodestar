import {DataColumnSidecar} from "@lodestar/types";
import {ChainEvent, ChainEventEmitter, PublishDataColumnsPartialTrigger} from "./emitter.js";

export function emitPublishedDataColumns(
  emitter: ChainEventEmitter,
  columns: DataColumnSidecar[],
  partialTrigger?: PublishDataColumnsPartialTrigger
): void {
  emitter.emit(ChainEvent.publishDataColumns, {
    columns,
    publishPartial: partialTrigger !== undefined,
    partialTrigger,
  });
}
