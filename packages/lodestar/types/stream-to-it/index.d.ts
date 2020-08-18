declare module "stream-to-it" {
  import {Readable} from "stream";
  export function source<T = Buffer | string>(readable: Readable): AsyncGenerator<T>;
}
