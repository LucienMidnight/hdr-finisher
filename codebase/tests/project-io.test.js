const assert = require("node:assert/strict");
const { test } = require("node:test");

const { HDRProjectIO } = require("../frontend/project-io.js");

function recordingFetch(payload = { ok: true }) {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => payload };
  };
  return { calls, fetchFn };
}

test("desktop project open owns grant shape and optional relink grant", async () => {
  const { calls, fetchFn } = recordingFetch({ session: { session_id: "s1" } });
  const controller = new AbortController();
  const result = await HDRProjectIO.openDesktopProject(fetchFn, {
    projectGrant: "project-token",
    sourceGrant: "source-token",
    signal: controller.signal,
  });
  assert.deepEqual(result.payload, { session: { session_id: "s1" } });
  assert.equal(calls[0].url, "/api/desktop/project/open");
  assert.equal(calls[0].options.signal, controller.signal);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    project_grant: "project-token",
    source_grant: "source-token",
  });
});

test("path project open omits a relink path until one exists", async () => {
  const { calls, fetchFn } = recordingFetch();
  await HDRProjectIO.openPathProject(fetchFn, { path: "D:/work/edit.hdrfinisher" });
  await HDRProjectIO.openPathProject(fetchFn, { path: "D:/work/edit.hdrfinisher", sourcePath: "D:/raw/source.dng" });
  assert.deepEqual(JSON.parse(calls[0].options.body), { path: "D:/work/edit.hdrfinisher" });
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    path: "D:/work/edit.hdrfinisher",
    source_path: "D:/raw/source.dng",
  });
});

test("desktop and path saves own their distinct endpoints and bodies", async () => {
  const { calls, fetchFn } = recordingFetch({ revision: 9 });
  await HDRProjectIO.saveDesktopProject(fetchFn, { sessionId: "session 1", projectGrant: "grant" });
  await HDRProjectIO.savePathProject(fetchFn, {
    sessionId: "session 1",
    path: "D:/work/edit.hdrfinisher",
    sourcePath: "D:/raw/source.dng",
  });
  assert.equal(calls[0].url, "/api/desktop/session/session 1/project/save");
  assert.deepEqual(JSON.parse(calls[0].options.body), { project_grant: "grant" });
  assert.equal(calls[1].url, "/api/session/session 1/project/save");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    path: "D:/work/edit.hdrfinisher",
    source_path: "D:/raw/source.dng",
  });
});

test("invalid response JSON remains a null payload", async () => {
  const payload = await HDRProjectIO.safeJson({ json: async () => { throw new SyntaxError("invalid"); } });
  assert.equal(payload, null);
});

test("project errors and source-relink signals are normalized", () => {
  assert.equal(HDRProjectIO.needsSourceRelink({ detail: { code: "source_relink_required" } }), true);
  assert.equal(HDRProjectIO.needsSourceRelink({ detail: { code: "other" } }), false);
  assert.equal(HDRProjectIO.responseErrorMessage({ detail: "plain" }, "fallback"), "plain");
  assert.equal(HDRProjectIO.responseErrorMessage({ detail: { message: "nested" } }, "fallback"), "nested");
  assert.equal(HDRProjectIO.responseErrorMessage({ message: "top" }, "fallback"), "top");
  assert.equal(HDRProjectIO.responseErrorMessage({}, "fallback"), "fallback");
});

test("import jobs own creation, polling, cancellation, and session lookup", async () => {
  const { calls, fetchFn } = recordingFetch({ state: "queued" });
  await HDRProjectIO.createImportJob(fetchFn, {
    grant: "source-grant",
    rawImportSettings: { demosaic: "high" },
    replaceSessionId: "old-session",
  });
  await HDRProjectIO.pollImportJob(fetchFn, "job-1");
  await HDRProjectIO.cancelImportJob(fetchFn, "job-1");
  await HDRProjectIO.fetchSession(fetchFn, "new-session");
  assert.equal(calls[0].url, "/api/import-jobs");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    grant: "source-grant",
    raw_import_settings: { demosaic: "high" },
    replace_session_id: "old-session",
  });
  assert.deepEqual(calls.slice(1).map(({ url, options }) => [url, options?.method || "GET"]), [
    ["/api/import-jobs/job-1", "GET"],
    ["/api/import-jobs/job-1", "DELETE"],
    ["/api/session/new-session", "GET"],
  ]);
});

test("byte uploads and current-session recovery keep FormData headers browser-owned", async () => {
  const { calls, fetchFn } = recordingFetch({ session: { session_id: "new" } });
  const formData = new FormData();
  formData.append("file", new Blob(["source"]), "source.tif");
  await HDRProjectIO.uploadSource(fetchFn, formData);
  await HDRProjectIO.fetchCurrentSession(fetchFn);
  await HDRProjectIO.ejectCurrentSession(fetchFn);
  assert.equal(calls[0].url, "/api/session");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.body, formData);
  assert.equal(calls[0].options.headers, undefined);
  assert.deepEqual(calls.slice(1).map(({ url, options }) => [url, options?.method || "GET"]), [
    ["/api/session/current", "GET"],
    ["/api/session/current", "DELETE"],
  ]);
});
