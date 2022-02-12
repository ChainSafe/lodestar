declare module "stream-to-it" {
  import {Readable} from "node:stream";
  export function source<T = Buffer | string>(readable: Readable): AsyncGenerator<T>;
}
