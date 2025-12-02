import {JobItemQueue} from "./itemQueue.js";
import {JobQueueOpts, QueueMetrics} from "./options.js";

// biome-ignore lint/suspicious/noExplicitAny: We need to use `any` type here
type Fn<R> = (...args: any) => Promise<R>;

// biome-ignore lint/suspicious/noExplicitAny: We need to use `any` type here
export class JobFnQueue extends JobItemQueue<[Fn<any>], any> {
  constructor(opts: JobQueueOpts, metrics?: QueueMetrics) {
    super((fn) => fn(), opts, metrics);
  }

  push<R, F extends Fn<R> = Fn<R>>(fn: F): Promise<R> {
    return super.push(fn) as Promise<R>;
  }
}
