export function generateRPCCall(
  method: string,
  params: any[]
): {
  method: string;
  params: any[];
  jsonrpc: string;
  id: number;
} {
  //TODO hex encode params
  return {
    method,
    params,
    jsonrpc: "2.0",
    id: Math.round(Math.random() * 1000),
  };
}
