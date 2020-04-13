export async function collect (source: AsyncIterable<unknown>): Promise<unknown[]> {
    const vals: unknown[] = [];
    for await (const val of source) {
        vals.push(val);
    }
    return vals;
}