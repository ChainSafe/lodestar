import {EmptyMeta, EmptyResponseData} from "../codecs.js";
import {HttpSuccessCodes} from "../httpStatusCode.js";
import {Endpoint, HasOnlyOptionalProps} from "../types.js";

type ApplicationResponseObject<E extends Endpoint> = {
  /**
   * Set non-200 success status code
   */
  status?: HttpSuccessCodes;
} & (E["return"] extends EmptyResponseData
  ? {data?: never}
  : {data: E["return"] | (E["return"] extends undefined ? undefined : Uint8Array)}) &
  (E["meta"] extends EmptyMeta ? {meta?: never} : {meta: E["meta"]});

export type ApplicationResponse<E extends Endpoint> = HasOnlyOptionalProps<ApplicationResponseObject<E>> extends true
  ? ApplicationResponseObject<E> | void
  : ApplicationResponseObject<E>;

export type ApiContext = {
  /**
   * Raw ssz bytes from request payload, only available for ssz requests
   */
  sszBytes?: Uint8Array | null;
  /**
   * Informs application method about preferable return type to avoid unnecessary serialization
   */
  returnBytes?: boolean;
};

type GenericOptions = Record<string, unknown>;

export type ApplicationMethod<E extends Endpoint> = (
  args: E["args"],
  context?: ApiContext,
  opts?: GenericOptions
) => Promise<ApplicationResponse<E>>;

export type ApplicationMethods<Es extends Record<string, Endpoint>> = {[K in keyof Es]: ApplicationMethod<Es[K]>};
