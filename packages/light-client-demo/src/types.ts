export interface ReqStatus<T = true, P = boolean> {
  loading?: P;
  error?: Error | string;
  result?: T;
}
