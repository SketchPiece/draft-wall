// One-off: copies every canvas from the old Vercel Blob store into CANVAS_DATA_DIR.
// With BLOB_READ_WRITE_TOKEN set (and CANVAS_STORE_PREFIX if one was used), copy to ./data, then onto the volume:
//   npx tsx scripts/migrate-blob.ts && railway volume files upload data/ /
import { get, list } from '@vercel/blob';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = process.env.CANVAS_DATA_DIR ?? 'data';
const prefix = process.env.CANVAS_STORE_PREFIX ?? '';
let cursor: string | undefined, count = 0;
do {
  const page = await list({ prefix, cursor });
  for (const blob of page.blobs) {
    const rest = blob.pathname.slice(prefix.length);
    // With no prefix, skip the dev/ copy that shares the store.
    if (!prefix && rest.startsWith('dev/')) continue;
    const r = await get(blob.pathname, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) throw new Error(`Could not read ${blob.pathname}`);
    const dest = join(root, rest);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await new Response(r.stream).arrayBuffer()));
    count++;
  }
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);
console.log(`Copied ${count} files into ${root}`);
