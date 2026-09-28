(function () {
  "use strict";

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function responseErrorMessage(payload, fallback) {
    if (typeof payload?.detail === "string") return payload.detail;
    if (typeof payload?.detail?.message === "string") return payload.detail.message;
    if (typeof payload?.message === "string") return payload.message;
    return fallback;
  }

  function needsSourceRelink(payload) {
    return payload?.detail?.code === "source_relink_required";
  }

  async function postJson(fetchFn, url, body, { signal } = {}) {
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    return { response, payload: await safeJson(response) };
  }

  async function requestJson(fetchFn, url, options) {
    const response = await fetchFn(url, options);
    return { response, payload: await safeJson(response) };
  }

  function openDesktopProject(fetchFn, { projectGrant, sourceGrant = null, signal } = {}) {
    return postJson(fetchFn, "/api/desktop/project/open", {
      project_grant: projectGrant,
      ...(sourceGrant ? { source_grant: sourceGrant } : {}),
    }, { signal });
  }

  function openPathProject(fetchFn, { path, sourcePath = null } = {}) {
    return postJson(fetchFn, "/api/project/open", {
      path,
      ...(sourcePath ? { source_path: sourcePath } : {}),
    });
  }

  function saveDesktopProject(fetchFn, { sessionId, projectGrant } = {}) {
    return postJson(fetchFn, `/api/desktop/session/${sessionId}/project/save`, {
      project_grant: projectGrant,
    });
  }

  function savePathProject(fetchFn, { sessionId, path, sourcePath } = {}) {
    return postJson(fetchFn, `/api/session/${sessionId}/project/save`, {
      path,
      source_path: sourcePath,
    });
  }

  function createImportJob(fetchFn, { grant, rawImportSettings, replaceSessionId } = {}) {
    return postJson(fetchFn, "/api/import-jobs", {
      grant,
      raw_import_settings: rawImportSettings || undefined,
      replace_session_id: replaceSessionId || null,
    });
  }

  function pollImportJob(fetchFn, jobId) {
    return requestJson(fetchFn, `/api/import-jobs/${jobId}`);
  }

  function cancelImportJob(fetchFn, jobId) {
    return fetchFn(`/api/import-jobs/${jobId}`, { method: "DELETE" });
  }

  function fetchSession(fetchFn, sessionId) {
    return requestJson(fetchFn, `/api/session/${sessionId}`);
  }

  function uploadSource(fetchFn, formData) {
    return requestJson(fetchFn, "/api/session", { method: "POST", body: formData });
  }

  function fetchCurrentSession(fetchFn) {
    return requestJson(fetchFn, "/api/session/current");
  }

  function ejectCurrentSession(fetchFn) {
    return fetchFn("/api/session/current", { method: "DELETE" });
  }

  const HDRProjectIO = Object.freeze({
    safeJson,
    responseErrorMessage,
    needsSourceRelink,
    openDesktopProject,
    openPathProject,
    saveDesktopProject,
    savePathProject,
    createImportJob,
    pollImportJob,
    cancelImportJob,
    fetchSession,
    uploadSource,
    fetchCurrentSession,
    ejectCurrentSession,
  });

  if (typeof window !== "undefined") window.HDRProjectIO = HDRProjectIO;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRProjectIO };
})();
