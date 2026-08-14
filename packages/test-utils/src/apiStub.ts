import {Mocked, vi} from "vitest";
import {ApiClientMethods, ApiResponse, Endpoint, Endpoints, HttpStatusCode, IHttpClient} from "@lodestar/api";

export type ApiClientStub = {[K in keyof Endpoints]: Mocked<ApiClientMethods<Endpoints[K]>>} & {
  httpClient: Mocked<IHttpClient>;
};

export const httpClientStub: IHttpClient = {
  baseUrl: "",
  request: vi.fn(),
  urlsInits: [],
  urlsScore: [],
};

// biome-ignore lint/suspicious/noExplicitAny: generic mock over arbitrary endpoints; only the return (T) and meta (M) type params matter here
export function mockApiResponse<T, M, E extends Endpoint<any, any, any, T, M>>({
  data,
  meta,
}: (E["return"] extends void ? {data?: never} : {data: E["return"]}) &
  (E["meta"] extends void ? {meta?: never} : {meta: E["meta"]})): ApiResponse<E> {
  const response = new Response(null, {status: HttpStatusCode.OK});
  // biome-ignore lint/suspicious/noExplicitAny: mock does not use the route definition
  const apiResponse = new ApiResponse<E>({} as any, null, response);
  apiResponse.value = () => data as T;
  apiResponse.meta = () => meta as M;
  return apiResponse;
}

export async function mockApiErrorResponse<E extends Endpoint>(status: HttpStatusCode): Promise<ApiResponse<E>> {
  // biome-ignore lint/suspicious/noExplicitAny: mock does not use the route definition
  const res = new ApiResponse<E>({} as any, null, new Response(null, {status}));
  await res.errorBody();
  return res;
}
