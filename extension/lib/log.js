// Event log facade. Delegates storage to the background service
// worker because content-script dynamic modules can't reach
// chrome.storage directly. Ring buffer cap lives in background.js.

async function sendBackground(kind, payload = {}) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ kind, ...payload }, (reply) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!reply || reply.ok !== true) {
          reject(new Error(reply?.error ?? "background error"));
          return;
        }
        resolve(reply.data);
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export async function readLog() {
  try {
    return (await sendBackground("log.read")) ?? [];
  } catch {
    return [];
  }
}

export async function clearLog() {
  try {
    await sendBackground("log.clear");
  } catch {
    // ignore
  }
}

export async function appendEvent(entry) {
  try {
    return await sendBackground("log.append", { entry });
  } catch {
    return null;
  }
}

/**
 * Wrap an async operation so its success/failure is logged
 * automatically. Returns the underlying result, re-throws on error
 * after logging.
 */
export async function withLogging(kind, context, fn) {
  try {
    const result = await fn();
    await appendEvent({
      level: "success",
      kind,
      message: "ok",
      context,
    });
    return result;
  } catch (err) {
    const msg =
      err && typeof err === "object" && "message" in err
        ? String(err.message)
        : String(err);
    const status =
      err && typeof err === "object" && "status" in err
        ? err.status
        : undefined;
    await appendEvent({
      level: "error",
      kind,
      message: msg,
      context: { ...context, status },
    });
    throw err;
  }
}
