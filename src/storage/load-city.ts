import {
  restoreLiveCity,
  validateLiveSave,
  type LiveSave,
} from "../simulation/live";
import {
  restoreLiveCheckpoint,
  type LiveCheckpoint,
} from "../simulation/checkpoint";
import { readCheckpoint } from "./live-checkpoint";

export async function loadSavedCity(
  save: LiveSave,
  progress: (n: number) => void,
  signal: AbortSignal,
) {
  validateLiveSave(save);
  // A denied/blocked cache must not prevent loading the portable record.
  const checkpoint = await Promise.race([
    readCheckpoint().catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(resolve, 1000)),
  ]);
  if (signal.aborted) throw new DOMException("중단", "AbortError");
  if (checkpoint) {
    try {
      const city = restoreLiveCheckpoint(checkpoint, save);
      if (
        Math.round(city.time * 10) === Math.round(save.time * 10) &&
        city.actions.length === save.actions.length &&
        city.council.records.length === (save.council?.length ?? 0)
      )
        return restoreLiveCity(save, progress, { initialCity: city, signal });
    } catch {
      /* Changed/corrupt caches fall back to the record, never replace it. */
    }
  }
  try {
    return await fromWorker(save, checkpoint, progress, signal);
  } catch (error) {
    if (signal.aborted || (error as Error).name !== "WorkerUnavailable")
      throw error;
    // Sandboxed browsers without workers still yield in small wall-clock slices.
    return restoreLiveCity(save, progress, { signal });
  }
}
function fromWorker(
  save: LiveSave,
  checkpoint: LiveCheckpoint | undefined,
  progress: (n: number) => void,
  signal: AbortSignal,
) {
  return new Promise<ReturnType<typeof restoreLiveCheckpoint>>(
    (resolve, reject) => {
      let worker: Worker;
      const unavailable = () => {
        const error = new Error("별도 계산을 시작하지 못했어요.");
        error.name = "WorkerUnavailable";
        return error;
      };
      try {
        worker = new Worker(
          new URL("../simulation/live-worker.ts", import.meta.url),
          { type: "module" },
        );
      } catch {
        reject(unavailable());
        return;
      }
      const done = () => {
        worker.terminate();
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        done();
        reject(new DOMException("불러오기를 중단했어요.", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      worker.onerror = (event) => {
        event.preventDefault();
        done();
        reject(unavailable());
      };
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") progress(data.progress);
        else if (data.type === "complete") {
          done();
          try {
            resolve(restoreLiveCheckpoint(data.checkpoint, save));
          } catch (error) {
            reject(error);
          }
        } else if (data.type === "error") {
          done();
          reject(new Error(data.message));
        }
      };
      worker.postMessage({ save, checkpoint });
    },
  );
}
