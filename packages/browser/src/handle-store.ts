import { NotSupportedError } from "@lokio/core";

const DB_NAME = "lokio";
const STORE = "handles";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new NotSupportedError("IndexedDB (needed to persist directory handles)"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () => reject(transaction.error ?? request.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Persists a directory handle in IndexedDB (database `lokio`, store `handles`)
 * so the app can reopen the same folder after a reload. Browsers keep the
 * handle, but permission usually has to be re-granted from a user gesture.
 */
export async function saveHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  await run("readwrite", (store) => store.put(handle, key));
}

/** Loads a handle saved with `saveHandle`, or `undefined`. */
export async function loadHandle(key: string): Promise<FileSystemDirectoryHandle | undefined> {
  return (await run("readonly", (store) => store.get(key))) as
    | FileSystemDirectoryHandle
    | undefined;
}

export async function deleteHandle(key: string): Promise<void> {
  await run("readwrite", (store) => store.delete(key));
}
