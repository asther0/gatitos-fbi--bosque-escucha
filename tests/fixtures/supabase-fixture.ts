// FIXTURE ONLY: read-only PostgREST stand-in for local tests and the recorded
// demo. Supports the eq./in. filters and limit used by the command center.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type Tables = Record<string, Record<string, unknown>[]>;

function matches(row: Record<string, unknown>, column: string, filter: string) {
  if (filter.startsWith("eq.")) return String(row[column]) === filter.slice(3);
  if (filter.startsWith("in.(")) return filter.slice(4, -1).split(",").map(v => v.replace(/^"|"$/g, "")).includes(String(row[column]));
  return true;
}

export async function startSupabaseFixture({ tables, port = 0 }: { tables: Tables; port?: number }) {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://fixture.local");
    const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
    response.setHeader("Content-Type", "application/json");
    if (request.method !== "GET" || !table || !tables[table]) {
      response.writeHead(404);
      return response.end(JSON.stringify({ message: "Fixture is read-only", code: "PGRST116" }));
    }
    let rows = tables[table];
    for (const [column, filter] of url.searchParams) {
      if (["select", "order", "limit", "offset"].includes(column)) continue;
      rows = rows.filter(row => matches(row, column, filter));
    }
    const limit = Number(url.searchParams.get("limit"));
    response.end(JSON.stringify(limit ? rows.slice(0, limit) : rows));
  });
  await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
