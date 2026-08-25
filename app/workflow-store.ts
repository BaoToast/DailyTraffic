import { emptyWorkflowState, type WorkflowState } from "./final-workflow";

const DB_NAME = "traffic-analysis-workflow";
const DB_VERSION = 1;

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("projects"))
        request.result.createObjectStore("projects", { keyPath: "projectId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadWorkflow(projectId: string): Promise<WorkflowState> {
  if (!projectId || typeof indexedDB === "undefined")
    return emptyWorkflowState();
  const db = await openDb();
  return new Promise((resolve) => {
    const request = db
      .transaction("projects", "readonly")
      .objectStore("projects")
      .get(projectId);
    request.onsuccess = () => {
      const saved = request.result?.state as Partial<WorkflowState> | undefined;
      const base = emptyWorkflowState();
      resolve(
        saved
          ? {
              ...base,
              ...saved,
              thresholds: { ...base.thresholds, ...(saved.thresholds ?? {}) },
              comparisonReports: saved.comparisonReports ?? [],
            }
          : base,
      );
    };
    request.onerror = () => resolve(emptyWorkflowState());
  });
}

export async function saveWorkflow(projectId: string, state: WorkflowState) {
  if (!projectId || typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put({
      projectId,
      state,
      updatedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteWorkflow(projectId: string) {
  if (!projectId || typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").delete(projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
