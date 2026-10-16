import type { LiveCheckpoint } from "../simulation/checkpoint";
let database: Promise<IDBDatabase> | undefined;
function open() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("mayor-live-state", 1);
    const timeout = setTimeout(
      () => reject(new Error("도시 저장소가 응답하지 않아요.")),
      3000,
    );
    request.onupgradeneeded = () =>
      request.result.createObjectStore("checkpoints");
    request.onsuccess = () => {
      clearTimeout(timeout);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timeout);
      reject(request.error);
    };
    request.onblocked = () => {
      clearTimeout(timeout);
      reject(new Error("도시 저장소를 열 수 없어요."));
    };
  }));
}
export async function readCheckpoint(): Promise<LiveCheckpoint | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("checkpoints")
      .objectStore("checkpoints")
      .get("latest");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
// Queue writes so an older asynchronous save cannot overwrite a newer city.
let writing = Promise.resolve();
function updateCheckpoint(change: (store: IDBObjectStore) => void) {
  const task = writing
    .catch(() => {})
    .then(async () => {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("checkpoints", "readwrite");
        change(transaction.objectStore("checkpoints"));
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () =>
          reject(transaction.error);
      });
    });
  writing = task;
  return task;
}
export function writeCheckpoint(checkpoint: LiveCheckpoint) {
  return updateCheckpoint((store) => store.put(checkpoint, "latest"));
}
// Wait for older writes before clearing, so they cannot bring the old city back.
export function clearCheckpoint() {
  return updateCheckpoint((store) => store.clear());
}
