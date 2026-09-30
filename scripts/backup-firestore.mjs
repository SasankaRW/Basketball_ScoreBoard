/**
 * Full Firestore export, for a project without the managed one.
 *
 * `gcloud firestore export` needs the Blaze plan, which this project is not on
 * — the same reason Cloud Functions and Storage are unavailable here. So this
 * walks every root collection, document and subcollection through the Admin
 * SDK and writes the lot to a single JSON file.
 *
 * It needs a service-account key, which no part of the running app has: the
 * deployed API routes read theirs from `FIREBASE_SERVICE_ACCOUNT` in Vercel's
 * environment, and that value is not readable from here. Generate one from
 * Firebase Console → Project Settings → Service Accounts, and keep it out of
 * the repo (`.gitignore` covers `*-firebase-adminsdk-*.json`).
 *
 *   node scripts/backup-firestore.mjs <service-account.json> [output.json]
 *
 * Firestore's own types are preserved in a restorable shape rather than
 * flattened: a timestamp keeps its seconds and nanoseconds, a reference keeps
 * its path. Restoring is not automatic — this is a copy to read and to rebuild
 * from deliberately, not a one-click rollback.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const [, , keyPath, outPathArg] = process.argv;

if (!keyPath) {
  console.error('usage: node scripts/backup-firestore.mjs <service-account.json> [output.json]');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outPath = outPathArg ?? `C:/dev/scoreboard-backups/firestore-${stamp}.json`;

/**
 * Duck-typed rather than `instanceof`: the Admin SDK re-exports these classes
 * from `@google-cloud/firestore`, and a mismatch between the two copies would
 * silently fall through to the object branch and mangle the value.
 */
function serialise(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(serialise);
  if (Buffer.isBuffer(value)) return { __type: 'bytes', base64: value.toString('base64') };

  if (typeof value === 'object') {
    if (typeof value.toDate === 'function' && typeof value.seconds === 'number') {
      return { __type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
    }
    if (typeof value.path === 'string' && typeof value.collection === 'function') {
      return { __type: 'reference', path: value.path };
    }
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
      return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialise(v)]));
  }

  return value;
}

let documentCount = 0;

async function exportCollection(collectionRef) {
  const snapshot = await collectionRef.get();
  const documents = {};

  for (const doc of snapshot.docs) {
    documentCount += 1;
    const entry = { data: serialise(doc.data()) };

    const subcollections = await doc.ref.listCollections();
    if (subcollections.length > 0) {
      entry.subcollections = {};
      for (const sub of subcollections) {
        entry.subcollections[sub.id] = await exportCollection(sub);
      }
    }

    documents[doc.id] = entry;
  }

  return documents;
}

const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// Progress goes to stderr, as in `with-vercel-dev.mjs`: it keeps stdout free
// for anything a caller might want to pipe, and it is what the lint rule allows.
console.error(`Exporting Firestore for ${serviceAccount.project_id}…`);

const roots = await db.listCollections();
const backup = {};

for (const collection of roots) {
  const before = documentCount;
  backup[collection.id] = await exportCollection(collection);
  console.error(`  ${collection.id}… ${documentCount - before} document(s)`);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      projectId: serviceAccount.project_id,
      collections: backup,
    },
    null,
    2,
  ),
);

console.error(`\n${documentCount} document(s) across ${roots.length} root collection(s)`);
console.error(`Written to ${outPath}`);
