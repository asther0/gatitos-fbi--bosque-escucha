// FIXTURE ONLY: starts local Supabase and Atomic Memory stand-ins with synthetic
// data so the sensor-context flow can be shown without production credentials.
// Usage: npx tsx scripts/atomic-memory-fixture-demo.ts
import { startAtomicMemoryFixture } from "../tests/fixtures/atomic-memory-fixture";
import { startSupabaseFixture } from "../tests/fixtures/supabase-fixture";
import { bosqueSeed } from "../tests/fixtures/bosque-seed";

const apiKey = "fixture-only-key";

async function main() {
  const supabase = await startSupabaseFixture({ tables: bosqueSeed(), port: 4611 });
  const memory = await startAtomicMemoryFixture({ apiKey, port: 4612 });
  console.log(`FIXTURE Supabase (solo lectura): ${supabase.url}`);
  console.log(`FIXTURE Atomic Memory (no es el servicio real): ${memory.url}`);
  console.log(`Arranca la web con:
SUPABASE_URL=${supabase.url} SUPABASE_SERVICE_ROLE_KEY=fixture OPERATOR_PASSWORD=fixture-demo SESSION_SECRET=fixture-session-secret \\
ATOMICMEMORY_API_URL=${memory.url} ATOMICMEMORY_API_KEY=${apiKey} npx next dev -H 127.0.0.1 -p 4601`);
}

void main();
