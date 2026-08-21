const SCRIPT_CANDIDATES = [
  "https://cdn.jsdelivr.net/gh/streambim/streambim-widget-api@master/dist/streambim-widget-api.min.js",
  "https://cdn.jsdelivr.net/npm/streambim-widget-api@2.0.1/dist/streambim-widget-api.min.js",
  "https://unpkg.com/streambim-widget-api@2.0.1/dist/streambim-widget-api.min.js",
];

const state = {
  connected: false,
  projectId: "",
  buildingId: "",
  userEmail: "",
  ids: {
    groupId: "",
    groupMemberId: "",
    folderId: "",
    folderAccessId: "",
    workflowId: "",
    workflowAccess: false,
    checklistId: "",
    checklistWorkflowId: "",
    checklistPublished: false,
  },
  logs: [],
  busy: false,
};

const $ = (id) => document.getElementById(id);
const elements = {
  connectionDot: $("connection-dot"), connectionLabel: $("connection-label"), connectionDetail: $("connection-detail"),
  projectId: $("project-id"), buildingId: $("building-id"), userEmail: $("user-email"), apiPath: $("api-path"),
  baseName: $("base-name"), groupName: $("group-name"), folderName: $("folder-name"), workflowName: $("workflow-name"), checklistName: $("checklist-name"),
  organization: $("organization"),
  sourceWorkflowId: $("source-workflow-id"), sourceChecklistId: $("source-checklist-id"), parentFolderId: $("parent-folder-id"), folderAccessLevel: $("folder-access-level"),
  writeEnabled: $("write-enabled"), statusMessage: $("status-message"), debugLog: $("debug-log"), completedCount: $("completed-count"),
};

function clean(value) { return String(value ?? "").trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function nowLabel() { return new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()); }
function storageKey() { return `streambim-ue-onboarding:${state.projectId || "unknown"}`; }

function redact(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.replace(/(id_token|access_token|authorization)(["'=:\s]+)[^&"\s]+/gi, "$1$2[REDACTED]");
}

function addLog(level, title, payload = "") {
  const record = { timestamp: new Date().toISOString(), level, title, payload: payload == null ? "" : payload };
  state.logs.push(record);
  const entry = document.createElement("article");
  entry.className = `log-entry ${level === "error" ? "error" : ""}`;
  const body = payload === "" ? "" : `<pre>${escapeHtml(redact(payload))}</pre>`;
  entry.innerHTML = `<time>${escapeHtml(nowLabel())}</time><strong>${escapeHtml(level.toUpperCase())}</strong><div>${escapeHtml(title)}</div>${body}`;
  elements.debugLog.prepend(entry);
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function setStatus(message, isError = false) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.toggle("error", isError);
}

function config() {
  return {
    groupName: clean(elements.groupName.value), folderName: clean(elements.folderName.value),
    workflowName: clean(elements.workflowName.value), checklistName: clean(elements.checklistName.value),
    organization: clean(elements.organization.value),
    sourceWorkflowId: clean(elements.sourceWorkflowId.value), sourceChecklistId: clean(elements.sourceChecklistId.value),
    parentFolderId: clean(elements.parentFolderId.value) || "0", folderAccessLevel: Number(elements.folderAccessLevel.value),
  };
}

function validateConfig() {
  const cfg = config();
  for (const [key, value] of Object.entries(cfg)) {
    if (key === "organization") continue;
    if (value === "" || value == null || (key === "folderAccessLevel" && !Number.isFinite(value))) throw new Error(`Fältet ${key} måste fyllas i.`);
  }
  return cfg;
}

function saveSession() {
  if (!state.projectId) return;
  localStorage.setItem(storageKey(), JSON.stringify({ ids: state.ids, config: config(), savedAt: new Date().toISOString() }));
}

function loadSession() {
  const raw = localStorage.getItem(storageKey());
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    state.ids = { ...state.ids, ...(saved.ids || {}) };
    const cfg = saved.config || {};
    for (const [key, id] of Object.entries({ groupName: "group-name", folderName: "folder-name", workflowName: "workflow-name", checklistName: "checklist-name", organization: "organization", sourceWorkflowId: "source-workflow-id", sourceChecklistId: "source-checklist-id", parentFolderId: "parent-folder-id", folderAccessLevel: "folder-access-level" })) {
      if (cfg[key] !== undefined) $(id).value = cfg[key];
    }
    addLog("info", "Sparad testsession återställd", { ids: state.ids, savedAt: saved.savedAt });
  } catch (error) { addLog("error", "Kunde inte läsa sparad testsession", error.message); }
}

function stepDone(step, text) {
  document.querySelector(`[data-step="${step}"]`)?.classList.add("done");
  document.querySelector(`[data-step="${step}"]`)?.classList.remove("failed");
  const resultIds = { group: "group-result", member: "member-result", folder: "folder-result", folderAccess: "folder-access-result", workflow: "workflow-result", workflowAccess: "workflow-access-result", checklist: "checklist-result", checklistPublish: "checklist-publish-result" };
  $(resultIds[step]).textContent = text;
  refreshControls();
}

function stepFailed(step, text) {
  if (!step) return;
  document.querySelector(`[data-step="${step}"]`)?.classList.add("failed");
  const resultIds = { group: "group-result", member: "member-result", folder: "folder-result", folderAccess: "folder-access-result", workflow: "workflow-result", workflowAccess: "workflow-access-result", checklist: "checklist-result", checklistPublish: "checklist-publish-result" };
  $(resultIds[step]).textContent = text;
}

function refreshControls() {
  const writable = state.connected && elements.writeEnabled.checked && !state.busy;
  $("check-names").disabled = !state.connected || state.busy;
  $("create-group").disabled = !writable;
  $("add-member").disabled = !writable || !state.ids.groupId;
  $("create-folder").disabled = !writable;
  $("grant-folder-access").disabled = !writable || !state.ids.groupId || !state.ids.folderId;
  $("copy-workflow").disabled = !writable;
  $("grant-workflow-access").disabled = !writable || !state.ids.groupId || !state.ids.workflowId;
  $("copy-checklist").disabled = !writable;
  $("publish-checklist").disabled = !writable || !state.ids.groupId || !state.ids.checklistId || !state.ids.checklistWorkflowId;
  const complete = [state.ids.groupId, state.ids.groupMemberId, state.ids.folderId, state.ids.folderAccessId, state.ids.workflowId, state.ids.workflowAccess, state.ids.checklistId, state.ids.checklistPublished].filter(Boolean).length;
  elements.completedCount.textContent = complete;
}

function restoreStepDisplay() {
  if (state.ids.groupId) stepDone("group", `Grupp-ID ${state.ids.groupId}`);
  if (state.ids.groupMemberId) stepDone("member", `Medlemskap ${state.ids.groupMemberId}`);
  if (state.ids.folderId) stepDone("folder", `Mapp-ID ${state.ids.folderId}`);
  if (state.ids.folderAccessId) stepDone("folderAccess", `Åtkomst ${state.ids.folderAccessId}`);
  if (state.ids.workflowId) stepDone("workflow", `Workflow-ID ${state.ids.workflowId}`);
  if (state.ids.workflowAccess) stepDone("workflowAccess", "Namn och åtkomst sparade");
  if (state.ids.checklistId) stepDone("checklist", `Checklista ${state.ids.checklistId} / workflow ${state.ids.checklistWorkflowId || "?"}`);
  if (state.ids.checklistPublished) stepDone("checklistPublish", "Åtkomst satt och publicerad");
}

function loadScript(src) {
  return new Promise((resolve, reject) => { const script = document.createElement("script"); script.src = src; script.onload = resolve; script.onerror = () => reject(new Error(`Kunde inte ladda ${src}`)); document.head.appendChild(script); });
}

async function ensureLibrary() {
  if (window.StreamBIM) return;
  let lastError;
  for (const src of SCRIPT_CANDIDATES) {
    try { addLog("info", "Laddar Widget API", src); await loadScript(src); if (window.StreamBIM) return; } catch (error) { lastError = error; }
  }
  throw lastError || new Error("streambim-widget-api kunde inte laddas.");
}

async function callApi(method, ...args) {
  const fn = window.StreamBIM?.API?.[method];
  if (typeof fn !== "function") throw new Error(`Widget API-metoden ${method} saknas.`);
  return fn.apply(window.StreamBIM.API, args);
}

function apiRoot() { return `/pgw/project-${state.projectId}/api/v1/v2`; }

async function request(endpoint, options = {}) {
  const method = options.method || "GET";
  const url = `${apiRoot()}${endpoint}`;
  const requestData = { url, method, accept: "application/vnd.api+json", contentType: "application/vnd.api+json" };
  if (options.body !== undefined) requestData.body = options.body;
  addLog("request", `${method} ${endpoint}`, options.body || "");
  let raw;
  try { raw = await callApi("makeApiRequest", requestData); } catch (error) {
    addLog("error", `${method} ${endpoint} misslyckades`, error.message || error);
    throw error;
  }
  if (typeof raw !== "string") { addLog("response", `${method} ${endpoint}`, raw); return raw; }
  const trimmed = raw.trim();
  if (!trimmed) { addLog("response", `${method} ${endpoint}`, "Tomt svar"); return null; }
  if (/^<!doctype|^<html/i.test(trimmed)) throw new Error(`API-svaret för ${url} var HTML i stället för JSON.`);
  try { const parsed = JSON.parse(trimmed); addLog("response", `${method} ${endpoint}`, parsed); return parsed; }
  catch { throw new Error(`API-svaret för ${url} var inte giltig JSON: ${trimmed.slice(0, 120)}`); }
}

function dataList(response) { return Array.isArray(response?.data) ? response.data : []; }
function relationId(resource, name) { return clean(resource?.relationships?.[name]?.data?.id); }
function normalizedGroupName(name) { return clean(name).replace(/^@/, "").toLocaleLowerCase("sv"); }

function mostCommonOrganization(groups) {
  const counts = new Map();
  for (const group of groups) {
    const organization = clean(group.attributes?.organization);
    if (organization) counts.set(organization, (counts.get(organization) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "";
}

async function listGroups() { return dataList(await request("/groups")); }
async function listFolders() { return dataList(await request("/folders?filter%5BisDeleted%5D=false")); }
async function listWorkflows() { return dataList(await request("/workflows?filter%5Baccessible%5D=true")); }
async function listChecklists() { return dataList(await request("/checklists?filter%5BisDraft%5D=false&filter%5BskipStatuses%5D=true")); }

async function checkNames() {
  const cfg = validateConfig();
  const [groups, folders, workflows, checklists] = await Promise.all([listGroups(), listFolders(), listWorkflows(), listChecklists()]);
  if (!cfg.organization) {
    const detectedOrganization = mostCommonOrganization(groups);
    if (detectedOrganization) {
      elements.organization.value = detectedOrganization;
      cfg.organization = detectedOrganization;
      addLog("info", "Organisation identifierad från befintliga grupper", detectedOrganization);
    }
  }
  const matches = {
    group: groups.filter((x) => normalizedGroupName(x.attributes?.name) === normalizedGroupName(cfg.groupName)).map((x) => ({ id: x.id, name: x.attributes?.name })),
    folder: folders.filter((x) => clean(x.attributes?.name) === cfg.folderName && relationId(x, "parent") === cfg.parentFolderId).map((x) => ({ id: x.id, name: x.attributes?.name })),
    workflow: workflows.filter((x) => clean(x.attributes?.name) === cfg.workflowName).map((x) => ({ id: x.id, name: x.attributes?.name })),
    checklist: checklists.filter((x) => clean(x.attributes?.name) === cfg.checklistName).map((x) => ({ id: x.id, name: x.attributes?.name })),
  };
  addLog("info", "Namnkontroll klar", matches);
  setStatus(Object.values(matches).some((items) => items.length) ? "Namnkontrollen hittade befintliga resurser. Skapa-knapparna återanvänder dem." : "Namnen är lediga i de listor widgeten kan läsa.");
  return matches;
}

async function withAction(step, title, action) {
  if (state.busy) return;
  state.busy = true; refreshControls(); setStatus(`${title}…`);
  try {
    const result = await action(); saveSession(); setStatus(`${title} klart.`); return result;
  } catch (error) {
    const message = error.message || String(error); addLog("error", title, message); stepFailed(step, message); setStatus(`${title} misslyckades: ${message}`, true);
  } finally { state.busy = false; refreshControls(); }
}

function requireWriteConfirmation(actionName) {
  if (!elements.writeEnabled.checked) throw new Error("Aktivera skrivande test först.");
  return window.confirm(`${actionName}\n\nDetta skriver data i projekt ${state.projectId}. Vill du fortsätta?`);
}

async function createGroup() {
  const cfg = validateConfig();
  const groups = await listGroups();
  const existing = groups.find((x) => normalizedGroupName(x.attributes?.name) === normalizedGroupName(cfg.groupName));
  if (existing) { state.ids.groupId = existing.id; stepDone("group", `Återanvänder grupp ${existing.id}`); addLog("info", "Befintlig grupp återanvänds", existing); return existing; }
  const organization = cfg.organization || mostCommonOrganization(groups);
  if (!organization) throw new Error("Fyll i organisation för gruppen. Den kunde inte identifieras automatiskt.");
  elements.organization.value = organization;
  if (!requireWriteConfirmation(`Skapa grupp "${cfg.groupName}"?`)) throw new Error("Åtgärden avbröts.");
  const response = await request("/groups", { method: "POST", body: { data: { attributes: { name: cfg.groupName, organization, description: null }, relationships: { "user-organization": { data: null } }, type: "groups" } } });
  state.ids.groupId = response?.data?.id || "";
  if (!state.ids.groupId) throw new Error("Gruppsvaret saknade ID.");
  stepDone("group", `Grupp-ID ${state.ids.groupId}`); return response.data;
}

async function addCurrentUser() {
  if (!state.ids.groupId || !state.userEmail) throw new Error("Grupp-ID eller användare saknas.");
  const members = dataList(await request("/group-members"));
  const existing = members.find((x) => relationId(x, "group") === state.ids.groupId && relationId(x, "user") === state.userEmail);
  if (existing) { state.ids.groupMemberId = existing.id; stepDone("member", `Återanvänder medlemskap ${existing.id}`); return existing; }
  if (!requireWriteConfirmation(`Lägg till ${state.userEmail} som admin i grupp ${state.ids.groupId}?`)) throw new Error("Åtgärden avbröts.");
  const response = await request("/group-members", { method: "POST", body: { data: { attributes: { "is-admin": true }, relationships: { group: { data: { type: "groups", id: state.ids.groupId } }, user: { data: { type: "users", id: state.userEmail } } }, type: "group-members" } } });
  state.ids.groupMemberId = response?.data?.id || "";
  if (!state.ids.groupMemberId) throw new Error("Medlemssvaret saknade ID.");
  stepDone("member", `Medlemskap ${state.ids.groupMemberId}`); return response.data;
}

async function createFolder() {
  const cfg = validateConfig();
  const existing = (await listFolders()).find((x) => clean(x.attributes?.name) === cfg.folderName && relationId(x, "parent") === cfg.parentFolderId);
  if (existing) { state.ids.folderId = existing.id; stepDone("folder", `Återanvänder mapp ${existing.id}`); return existing; }
  if (!requireWriteConfirmation(`Skapa mapp "${cfg.folderName}" under mapp ${cfg.parentFolderId}?`)) throw new Error("Åtgärden avbröts.");
  const response = await request("/folders", { method: "POST", body: { data: { attributes: { "is-deleted": false, name: cfg.folderName }, relationships: { parent: { data: { type: "folders", id: cfg.parentFolderId } } }, type: "folders" } } });
  state.ids.folderId = response?.data?.id || "";
  if (!state.ids.folderId) throw new Error("Mappsvaret saknade ID.");
  stepDone("folder", `Mapp-ID ${state.ids.folderId}`); return response.data;
}

async function grantFolderAccess() {
  const cfg = validateConfig();
  const accesses = dataList(await request(`/folder-accesses?filter%5BinheritedFromFolders%5D=true&filter%5BfolderId%5D=${encodeURIComponent(state.ids.folderId)}`));
  const existing = accesses.find((x) => relationId(x, "group") === state.ids.groupId && relationId(x, "folder") === state.ids.folderId);
  if (existing) { state.ids.folderAccessId = existing.id; stepDone("folderAccess", `Återanvänder åtkomst ${existing.id}`); return existing; }
  if (!requireWriteConfirmation(`Ge grupp ${state.ids.groupId} access-level ${cfg.folderAccessLevel} till mapp ${state.ids.folderId}?`)) throw new Error("Åtgärden avbröts.");
  const response = await request("/folder-accesses", { method: "POST", body: { data: { attributes: { "access-level": cfg.folderAccessLevel, inherited: false }, relationships: { group: { data: { type: "groups", id: state.ids.groupId } }, folder: { data: { type: "folders", id: state.ids.folderId } } }, type: "folder-accesses" } } });
  state.ids.folderAccessId = response?.data?.id || "";
  if (!state.ids.folderAccessId) throw new Error("Behörighetssvaret saknade ID.");
  stepDone("folderAccess", `Åtkomst ${state.ids.folderAccessId}`); return response.data;
}

async function copyWorkflow() {
  const cfg = validateConfig();
  const existing = (await listWorkflows()).find((x) => clean(x.attributes?.name) === cfg.workflowName);
  if (existing) { state.ids.workflowId = existing.id; stepDone("workflow", `Återanvänder workflow ${existing.id}`); return existing; }
  if (!requireWriteConfirmation(`Kopiera workflow ${cfg.sourceWorkflowId}?`)) throw new Error("Åtgärden avbröts.");
  const response = await request("/workflows", { method: "POST", body: { data: { attributes: { name: null, description: "", positionless: false, title: "", "due-days": -1, cost: "", "send-notification": false }, relationships: { "copy-workflow": { data: { type: "workflows", id: cfg.sourceWorkflowId } }, "assigned-to-user": { data: null }, "assigned-to-group": { data: null } }, type: "workflows" } } });
  state.ids.workflowId = response?.data?.id || "";
  if (!state.ids.workflowId) throw new Error("Workflow-svaret saknade ID.");
  stepDone("workflow", `Workflow-ID ${state.ids.workflowId}`); return response.data;
}

function rel(resource, name, fallback = null) { return clone(resource?.relationships?.[name]?.data ?? fallback); }
function mergeGroupRelation(resource, name, groupId) {
  const items = Array.isArray(rel(resource, name, [])) ? rel(resource, name, []) : [];
  if (!items.some((x) => clean(x.id) === groupId && x.type === "groups")) items.push({ type: "groups", id: groupId });
  return items;
}

function workflowPatch(resource, workflowId, name, groupId) {
  const a = resource.attributes || {};
  return { data: { id: workflowId, attributes: { name, description: a.description || "", positionless: Boolean(a.positionless), title: a.title || "", "due-days": a["due-days"] ?? null, cost: a.cost || "", "send-notification": Boolean(a["send-notification"]) }, relationships: {
    editors: { data: rel(resource, "editors", []) }, "copy-workflow": { data: null }, "workflow-classification": { data: rel(resource, "workflow-classification") }, logo: { data: rel(resource, "logo") },
    "assigned-to-user": { data: rel(resource, "assigned-to-user") }, "assigned-to-group": { data: rel(resource, "assigned-to-group") }, labels: { data: rel(resource, "labels", []) }, priority: { data: rel(resource, "priority") },
    "topic-classifications": { data: rel(resource, "topic-classifications", []) }, "general-access": { data: mergeGroupRelation(resource, "general-access", groupId) },
    "can-edit-assigned-to-and-due-date": { data: rel(resource, "can-edit-assigned-to-and-due-date", []) }, "can-be-assigned": { data: rel(resource, "can-be-assigned", []) }, "can-set-cost": { data: rel(resource, "can-set-cost", []) },
    "can-set-priority": { data: rel(resource, "can-set-priority", []) }, "can-close": { data: rel(resource, "can-close", []) }, "can-comment": { data: rel(resource, "can-comment", []) },
  }, type: "workflows" } };
}

async function patchWorkflowAccess() {
  const cfg = validateConfig();
  if (!requireWriteConfirmation(`Namnge workflow ${state.ids.workflowId} och ge grupp ${state.ids.groupId} general-access?`)) throw new Error("Åtgärden avbröts.");
  const resource = (await request(`/workflows/${state.ids.workflowId}`))?.data;
  if (!resource) throw new Error("Kunde inte läsa workflow före uppdatering.");
  await request(`/workflows/${state.ids.workflowId}`, { method: "PATCH", body: workflowPatch(resource, state.ids.workflowId, cfg.workflowName, state.ids.groupId) });
  state.ids.workflowAccess = true; stepDone("workflowAccess", "Namn och åtkomst sparade");
}

async function copyChecklist() {
  const cfg = validateConfig();
  const existing = (await listChecklists()).find((x) => clean(x.attributes?.name) === cfg.checklistName);
  if (existing) {
    state.ids.checklistId = existing.id; state.ids.checklistWorkflowId = relationId(existing, "workflow");
    stepDone("checklist", `Återanvänder ${existing.id} / workflow ${state.ids.checklistWorkflowId || "?"}`); return existing;
  }
  if (!requireWriteConfirmation(`Kopiera checklista ${cfg.sourceChecklistId}?`)) throw new Error("Åtgärden avbröts.");
  const response = await request("/checklists", { method: "POST", body: { data: { attributes: { interval: 1, "repeat-every": null, name: null, "field-for-title": "Name", "group-by": null, "make-new-snapshot": false, "is-draft": true, "workflow-prefix": null, "use-whitelist": false, "start-date": null, "end-date": null, "renewed-date": null, "process-report-id": null, "copy-item": null, "copy-for-object": null, "copy-item-meta-title": null, "copy-item-meta-description": null }, relationships: { "copy-checklist": { data: { type: "checklists", id: cfg.sourceChecklistId } } }, type: "checklists" } } });
  state.ids.checklistId = response?.data?.id || ""; state.ids.checklistWorkflowId = relationId(response?.data, "workflow");
  if (!state.ids.checklistId || !state.ids.checklistWorkflowId) throw new Error("Checklistsvaret saknade checklist- eller workflow-ID.");
  stepDone("checklist", `Checklista ${state.ids.checklistId} / workflow ${state.ids.checklistWorkflowId}`); return response.data;
}

function checklistPatch(resource, checklistId, name, workflowId) {
  const a = resource.attributes || {};
  const ifcQueryId = relationId(resource, "ifc-query");
  return { data: { id: checklistId, attributes: { interval: a.interval ?? 1, "repeat-every": a["repeat-every"] ?? null, "days-of-week": a["days-of-week"] ?? null, "days-in-month": a["days-in-month"] ?? null, "months-in-year": a["months-in-year"] ?? null, name, "field-for-title": a["field-for-title"] || "Name", "group-by": a["group-by"] || "", "make-new-snapshot": Boolean(a["make-new-snapshot"]), "is-draft": false, "workflow-prefix": a["workflow-prefix"] || "", "use-whitelist": Boolean(a["use-whitelist"]), tags: a.tags ?? null, "start-date": a["start-date"] ?? null, "end-date": a["end-date"] ?? null, "renewed-date": a["renewed-date"] ?? null, "process-report-id": "", "copy-item": "", "copy-for-object": "", "copy-item-meta-title": "", "copy-item-meta-description": "" }, relationships: {
    participants: { data: rel(resource, "participants", []) }, "ifc-query": { data: ifcQueryId ? { type: "ifc-queries", id: ifcQueryId } : null }, workflow: { data: { type: "workflows", id: workflowId } },
    "copy-checklist": { data: null }, buildings: { data: rel(resource, "buildings", []) }, "on-wagon": { data: rel(resource, "on-wagon") }, logo: { data: rel(resource, "logo") },
    "whitelist-objects": { data: rel(resource, "whitelist-objects", []) }, "blacklist-objects": { data: rel(resource, "blacklist-objects", []) },
  }, type: "checklists" } };
}

async function publishChecklist() {
  const cfg = validateConfig();
  if (!requireWriteConfirmation(`Ge gruppåtkomst och publicera checklista ${state.ids.checklistId}?`)) throw new Error("Åtgärden avbröts.");
  const workflowResource = (await request(`/workflows/${state.ids.checklistWorkflowId}`))?.data;
  if (!workflowResource) throw new Error("Kunde inte läsa checklistans workflow.");
  await request(`/workflows/${state.ids.checklistWorkflowId}`, { method: "PATCH", body: workflowPatch(workflowResource, state.ids.checklistWorkflowId, workflowResource.attributes?.name || "", state.ids.groupId) });
  const checklistResource = (await request(`/checklists/${state.ids.checklistId}`))?.data;
  if (!checklistResource) throw new Error("Kunde inte läsa checklistan före publicering.");
  await request(`/checklists/${state.ids.checklistId}`, { method: "PATCH", body: checklistPatch(checklistResource, state.ids.checklistId, cfg.checklistName, state.ids.checklistWorkflowId) });
  state.ids.checklistPublished = true; stepDone("checklistPublish", "Åtkomst satt och publicerad");
}

async function loadContext() {
  const [projectId, buildingId, userEmail] = await Promise.all([callApi("getProjectId"), callApi("getBuildingId"), callApi("getUserEmail")]);
  state.projectId = clean(projectId); state.buildingId = clean(buildingId); state.userEmail = clean(userEmail);
  if (!state.projectId) throw new Error("StreamBIM returnerade inget projekt-ID.");
  elements.projectId.textContent = state.projectId; elements.buildingId.textContent = state.buildingId || "–"; elements.userEmail.textContent = state.userEmail || "–";
  elements.apiPath.textContent = `/pgw/project-${state.projectId}`;
  elements.connectionDetail.textContent = `Projekt ${state.projectId} · ${state.userEmail}`;
}

async function connect() {
  try {
    await ensureLibrary();
    if (typeof window.StreamBIM?.connectToParent !== "function") throw new Error("Det laddade Widget API-biblioteket saknar connectToParent.");
    await Promise.race([
      window.StreamBIM.connectToParent(window.parent, { beforeInit: () => addLog("event", "beforeInit") }),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("Ingen StreamBIM-parent svarade inom 12 sekunder.")), 12000)),
    ]);
    state.connected = true; await loadContext(); loadSession(); restoreStepDisplay();
    elements.connectionDot.classList.add("live"); elements.connectionLabel.textContent = "Ansluten till StreamBIM";
    setStatus("Ansluten. Börja med Kontrollera namn, aktivera sedan skrivande test när du är redo.");
    addLog("info", "Widget ansluten", { projectId: state.projectId, buildingId: state.buildingId, userEmail: state.userEmail });
  } catch (error) {
    state.connected = false; elements.connectionLabel.textContent = "Inte ansluten"; elements.connectionDetail.textContent = "Öppna widgeten inifrån StreamBIM";
    setStatus(`Anslutningen misslyckades: ${error.message || error}`, true); addLog("error", "connectToParent", error.message || error);
  } finally { refreshControls(); }
}

function bindAction(id, step, title, fn) { $(id).addEventListener("click", () => withAction(step, title, fn)); }

$("apply-base-name").addEventListener("click", () => { const value = clean(elements.baseName.value) || "_TEST"; [elements.groupName, elements.folderName, elements.workflowName, elements.checklistName].forEach((input) => { input.value = value; }); saveSession(); setStatus(`Namnet "${value}" används nu för alla resurser.`); });
elements.writeEnabled.addEventListener("change", refreshControls);
$("refresh-context").addEventListener("click", () => withAction("", "Laddar projektkontext", loadContext));
$("check-names").addEventListener("click", () => withAction("", "Kontrollerar namn", checkNames));
bindAction("create-group", "group", "Skapar grupp", createGroup);
bindAction("add-member", "member", "Lägger till gruppadmin", addCurrentUser);
bindAction("create-folder", "folder", "Skapar mapp", createFolder);
bindAction("grant-folder-access", "folderAccess", "Sätter mappbehörighet", grantFolderAccess);
bindAction("copy-workflow", "workflow", "Kopierar workflow", copyWorkflow);
bindAction("grant-workflow-access", "workflowAccess", "Sätter workflowåtkomst", patchWorkflowAccess);
bindAction("copy-checklist", "checklist", "Kopierar checklista", copyChecklist);
bindAction("publish-checklist", "checklistPublish", "Slutför checklista", publishChecklist);

$("reset-session").addEventListener("click", () => {
  if (!window.confirm("Nollställ endast widgetens lokalt sparade ID:n? Inget raderas i StreamBIM.")) return;
  localStorage.removeItem(storageKey()); location.reload();
});
$("clear-log").addEventListener("click", () => { state.logs = []; elements.debugLog.innerHTML = ""; });
$("copy-log").addEventListener("click", async () => { await navigator.clipboard.writeText(JSON.stringify(state.logs, null, 2)); setStatus("Loggen kopierades."); });
$("download-log").addEventListener("click", () => { const blob = new Blob([JSON.stringify({ projectId: state.projectId, ids: state.ids, config: config(), logs: state.logs }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `streambim-onboarding-${state.projectId || "log"}-${Date.now()}.json`; link.click(); URL.revokeObjectURL(url); });

refreshControls();
connect();
