import { restoreLiveCity, validateLiveSave } from "./live";
import { captureLiveCheckpoint, restoreLiveCheckpoint } from "./checkpoint";
self.onmessage = async ({ data }) => {
  try {
    const save = validateLiveSave(data.save);
    let initialCity;
    if (data.checkpoint) {
      try {
        initialCity = restoreLiveCheckpoint(data.checkpoint, save);
      } catch {
        /* Replay an incompatible cache. */
      }
    }
    const start = initialCity?.time ?? 0;
    const city = await restoreLiveCity(
      save,
      (progress) => self.postMessage({ type: "progress", progress }),
      { initialCity, chunkMs: 100 },
    );
    self.postMessage({
      type: "complete",
      checkpoint: captureLiveCheckpoint(city),
      replayedSeconds: save.time - start,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error ? error.message : "도시 기록을 확인해 주세요.",
    });
  }
};
