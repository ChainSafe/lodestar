import type {Stream} from "@libp2p/interface";
import {Uint8ArrayList} from "uint8arraylist";
import {ErrorAborted} from "@lodestar/utils";

export async function sendChunks(
  stream: Stream,
  source: AsyncIterable<Uint8Array | Uint8ArrayList>,
  signal?: AbortSignal
): Promise<void> {
  for await (const chunk of source) {
    if (signal?.aborted) {
      throw new ErrorAborted("sendChunks");
    }

    if (!stream.send(chunk)) {
      await stream.onDrain({signal});
    }
  }
}
