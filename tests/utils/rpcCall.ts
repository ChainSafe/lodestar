
export function generateRPCCall(method: string, params: Array<any>): object {
    //TODO hex encode params
    return {
        method,
        params,
        jsonrpc: "2.0",
        id: Math.round(Math.random() * 1000)
    }
}
