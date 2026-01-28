const statusEl = document.getElementById("status");
const plotsEl = document.getElementById("plots");
const fpsEl = document.getElementById("fps");
const recvRateEl = document.getElementById("recv-rate");
const autoscaleToggle = document.getElementById("autoscale");
const zoomLevelEl = document.getElementById("zoom-level");
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const zoomResetBtn = document.getElementById("zoom-reset");
const zoomSlider = document.getElementById("zoom-slider");
const syncViewsToggle = document.getElementById("sync-views");
const exportSnapshotBtn = document.getElementById("export-snapshot");
const controlPanel = document.getElementById("control-panel");
const panelHandle = document.getElementById("panel-handle");
const panelTabButtons = document.querySelectorAll("[data-panel-tab]");
const panelTabPages = document.querySelectorAll("[data-panel-page]");
const detectorButtons = document.querySelectorAll("[data-detector-cmd]");
const detectorCommandStatus = document.getElementById("detector-command-status");
const detectorApplyBtn = document.getElementById("detector-apply");
const detectorConfigStatus = document.getElementById("detector-config-status");
const detectorCountTime = document.getElementById("detector-count-time");
const detectorFrameTime = document.getElementById("detector-frame-time");
const detectorTriggerMode = document.getElementById("detector-trigger-mode");
const detectorNTrigger = document.getElementById("detector-ntrigger");
const detectorNImages = document.getElementById("detector-nimages");
const gridXInput = document.getElementById("grid-x");
const gridYInput = document.getElementById("grid-y");
const gridApplyBtn = document.getElementById("grid-apply");
const gridStatus = document.getElementById("grid-status");
const detectorIpInput = document.getElementById("detector-ip");
const detectorZmqPortInput = document.getElementById("detector-zmq-port");
const detectorApiPortInput = document.getElementById("detector-api-port");
const endpointApplyBtn = document.getElementById("endpoint-apply");
const endpointStatus = document.getElementById("endpoint-status");
const paramSearchInput = document.getElementById("param-search");
const paramBrowser = document.getElementById("param-browser");
const paramFilterConfig = document.getElementById("param-filter-config");
const paramFilterStatus = document.getElementById("param-filter-status");
const paramFilterCommand = document.getElementById("param-filter-command");
const paramFilterImages = document.getElementById("param-filter-images");
const paramFavoritesOnly = document.getElementById("param-favorites-only");
const paramExpandBtn = document.getElementById("param-expand");
const paramCollapseBtn = document.getElementById("param-collapse");
const paramFavoritesEditBtn = document.getElementById("param-favorites-edit");
const paramFavoritesEditor = document.getElementById("param-favorites-editor");
const paramFavoritesText = document.getElementById("param-favorites-text");
const paramFavoritesSave = document.getElementById("param-favorites-save");
const paramFavoritesCancel = document.getElementById("param-favorites-cancel");
const colorSchemeSelect = document.getElementById("color-scheme");
const contrastMin = document.getElementById("contrast-min");
const contrastMax = document.getElementById("contrast-max");
const contrastMinValue = document.getElementById("contrast-min-value");
const contrastMaxValue = document.getElementById("contrast-max-value");
const histogramCanvas = document.getElementById("histogram-canvas");
const histogramCtx = histogramCanvas?.getContext("2d");
const histogramLogToggle = document.getElementById("histogram-log");
const detectorStatusEl = document.getElementById("status-detector");
const streamStatusEl = document.getElementById("status-stream");
const filewriterStatusEl = document.getElementById("status-filewriter");
const monitorStatusEl = document.getElementById("status-monitor");
const footerEl = document.querySelector(".footer-status");
const headerEl = document.querySelector("header");
const plotsContainer = document.getElementById("plots");
const accentColor = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0f766e";
const staleBanner = document.getElementById("stale-banner");

let gridX = 0;
let gridY = 0;
const plots = new Map();
let lastFrameTime = performance.now();
let frameCount = 0;
let lastRecvCount = null;
let lastRecvTime = 0;
let globalZoom = 1;
const labelMinPixels = 20;
let currentScheme = "blue-yellow-red";
let manualMin = 0;
let manualMax = 255;
const mobileQuery = window.matchMedia("(max-width: 900px)");
const isMobile = () => mobileQuery.matches;
let paramRows = [];
let paramSections = [];
let paramModules = [];
const defaultParamFavorites = [
  { module: "detector", section: "command", name: "initialize" },
  { module: "detector", section: "command", name: "arm" },
  { module: "detector", section: "command", name: "trigger" },
  { module: "detector", section: "command", name: "disarm" },
  { module: "detector", section: "config", name: "count_time" },
  { module: "detector", section: "config", name: "frame_time" },
  { module: "detector", section: "config", name: "trigger_mode" },
  { module: "detector", section: "config", name: "ntrigger" },
  { module: "detector", section: "config", name: "nimages" },
  { module: "detector", section: "config", name: "threshold/n/energy" },
  { module: "detector", section: "config", name: "threshold/n/mode" },
  { module: "stream", section: "config", name: "mode" },
  { module: "stream", section: "config", name: "format" },
  { module: "monitor", section: "config", name: "mode" },
  { module: "filewriter", section: "config", name: "mode" },
  { module: "filewriter", section: "config", name: "format" },
  { module: "filewriter", section: "config", name: "name_pattern" },
];
let currentFavorites = [];
let currentFavoriteSet = new Set();
let paramDefs = null;
let detectorPollId = null;
let detectorPollInFlight = false;

function activatePanelTab(name) {
  if (![...panelTabButtons].some((btn) => btn.dataset.panelTab === name)) {
    name = "ui";
  }
  panelTabButtons.forEach((btn) => {
    const active = btn.dataset.panelTab === name;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  panelTabPages.forEach((page) => {
    const active = page.dataset.panelPage === name;
    page.classList.toggle("is-hidden", !active);
  });
  localStorage.setItem("panelTab", name);
  if (name === "detector") {
    loadDetectorConfig({ silent: false });
    startDetectorPoll();
  } else {
    stopDetectorPoll();
  }
}

const storedTab = localStorage.getItem("panelTab");
if (storedTab) {
  activatePanelTab(storedTab);
}

panelTabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    activatePanelTab(btn.dataset.panelTab);
  });
});

detectorButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const cmd = btn.dataset.detectorCmd;
    if (!cmd) return;
    detectorCommandStatus.textContent = `Sending ${cmd}...`;
    try {
      const res = await fetch(`/detector/command/${cmd}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        detectorCommandStatus.textContent = `${cmd} ok`;
      } else {
        detectorCommandStatus.textContent = `${cmd} failed (${data.status || res.status})`;
      }
    } catch (err) {
      detectorCommandStatus.textContent = `${cmd} failed`;
    }
  });
});

async function applyDetectorConfig(param, value) {
  const res = await fetch(`/detector/config/${param}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: data.ok, status: data.status || res.status };
}

detectorApplyBtn?.addEventListener("click", async () => {
  const updates = [];
  if (detectorCountTime?.value) {
    updates.push(["count_time", parseFloat(detectorCountTime.value)]);
  }
  if (detectorFrameTime?.value) {
    updates.push(["frame_time", parseFloat(detectorFrameTime.value)]);
  }
  if (detectorTriggerMode?.value) {
    updates.push(["trigger_mode", detectorTriggerMode.value]);
  }
  if (detectorNTrigger?.value) {
    updates.push(["ntrigger", parseInt(detectorNTrigger.value, 10)]);
  }
  if (detectorNImages?.value) {
    updates.push(["nimages", parseInt(detectorNImages.value, 10)]);
  }

  if (updates.length === 0) {
    detectorConfigStatus.textContent = "No settings to apply.";
    return;
  }

  detectorConfigStatus.textContent = "Applying settings...";
  for (const [param, value] of updates) {
    if (!Number.isFinite(value) && typeof value === "number") {
      detectorConfigStatus.textContent = `Invalid value for ${param}`;
      return;
    }
    const result = await applyDetectorConfig(param, value);
    if (!result.ok) {
      detectorConfigStatus.textContent = `${param} failed (${result.status})`;
      return;
    }
  }
  detectorConfigStatus.textContent = "Settings applied.";
});

gridApplyBtn?.addEventListener("click", async () => {
  const x = gridXInput?.value ? parseInt(gridXInput.value, 10) : NaN;
  const y = gridYInput?.value ? parseInt(gridYInput.value, 10) : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 1 || y < 1) {
    if (gridStatus) gridStatus.textContent = "Invalid grid size.";
    return;
  }
  if (gridStatus) gridStatus.textContent = "Updating grid...";
  try {
    const res = await fetch("/ui/grid", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grid_x: x, grid_y: y }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      if (gridStatus) gridStatus.textContent = "Grid updated.";
    } else {
      if (gridStatus) gridStatus.textContent = `Grid update failed (${data.status || res.status}).`;
    }
  } catch (_) {
    if (gridStatus) gridStatus.textContent = "Grid update failed.";
  }
});

endpointApplyBtn?.addEventListener("click", async () => {
  const ip = detectorIpInput?.value?.trim();
  const zmqPort = detectorZmqPortInput?.value ? parseInt(detectorZmqPortInput.value, 10) : NaN;
  const apiPort = detectorApiPortInput?.value ? parseInt(detectorApiPortInput.value, 10) : NaN;
  if (!ip) {
    if (endpointStatus) endpointStatus.textContent = "Detector IP required.";
    return;
  }
  if (!Number.isFinite(zmqPort) || !Number.isFinite(apiPort)) {
    if (endpointStatus) endpointStatus.textContent = "Invalid ports.";
    return;
  }
  if (endpointStatus) endpointStatus.textContent = "Updating connection...";
  try {
    const res = await fetch("/ui/endpoint", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        detector_ip: ip,
        zmq_port: zmqPort,
        api_port: apiPort,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      if (endpointStatus) endpointStatus.textContent = "Connection updated.";
    } else {
      if (endpointStatus) endpointStatus.textContent = `Connection update failed (${data.status || res.status}).`;
    }
  } catch (_) {
    if (endpointStatus) endpointStatus.textContent = "Connection update failed.";
  }
});

async function loadDetectorConfig({ silent } = {}) {
  if (detectorPollInFlight) return;
  const fields = [
    ["count_time", detectorCountTime],
    ["frame_time", detectorFrameTime],
    ["trigger_mode", detectorTriggerMode],
    ["ntrigger", detectorNTrigger],
    ["nimages", detectorNImages],
  ];
  if (!fields.some(([, el]) => el)) return;
  detectorPollInFlight = true;
  if (!silent) {
    detectorConfigStatus.textContent = "Loading current settings...";
  }
  try {
    for (const [param, el] of fields) {
      if (!el) continue;
      if (document.activeElement === el) continue;
      try {
        const res = await fetch(`/simplon/detector/config/${encodeParamPath(param)}`);
        const data = await res.json().catch(() => ({}));
        if (data.ok) {
          const value = extractValueFromBody(data.body);
          if (value !== null && value !== undefined) {
            el.value = typeof value === "string" ? value : String(value);
          }
        }
      } catch (_) {
        // ignore; keep existing value
      }
    }
  } finally {
    detectorPollInFlight = false;
  }
  if (!silent) {
    detectorConfigStatus.textContent = "Loaded current settings.";
  }
}

function startDetectorPoll() {
  if (detectorPollId != null) return;
  detectorPollId = window.setInterval(() => {
    const page = document.querySelector("[data-panel-page=\"detector\"]");
    if (page && !page.classList.contains("is-hidden")) {
      loadDetectorConfig({ silent: true });
    }
  }, 5000);
}

function stopDetectorPoll() {
  if (detectorPollId == null) return;
  window.clearInterval(detectorPollId);
  detectorPollId = null;
}

function encodeParamPath(param) {
  return param
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function parseParamValue(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Value required." };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (_) {
    return { ok: true, value: trimmed };
  }
}

function formatParamResult(body) {
  if (body == null) return "";
  if (typeof body !== "string") {
    try {
      return JSON.stringify(body, null, 2);
    } catch (_) {
      return String(body);
    }
  }
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch (_) {
    return trimmed;
  }
}

function buildFavoriteSet(favorites) {
  const set = new Set();
  (favorites || []).forEach((fav) => {
    const name = (fav.name || "").toLowerCase();
    const module = (fav.module || "").toLowerCase();
    const section = (fav.section || "").toLowerCase();
    if (!name || !module || !section) return;
    set.add(`${module}|${section}|${name}`);
  });
  return set;
}

function formatFavorites(favorites) {
  return (favorites || [])
    .map((fav) => `${fav.module}/${fav.section}/${fav.name}`)
    .join("\n");
}

function parseFavoritesInput(text) {
  const out = [];
  const lines = (text || "").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let module = "";
    let section = "";
    let name = "";
    if (trimmed.includes("/")) {
      const parts = trimmed.split("/").map((p) => p.trim()).filter(Boolean);
      if (parts.length < 3) continue;
      module = parts[0];
      section = parts[1];
      name = parts.slice(2).join("/");
    } else if (trimmed.includes(".")) {
      const parts = trimmed.split(".").map((p) => p.trim()).filter(Boolean);
      if (parts.length < 3) continue;
      module = parts[0];
      section = parts[1];
      name = parts.slice(2).join(".");
    } else {
      continue;
    }
    out.push({ module: module.toLowerCase(), section: section.toLowerCase(), name: name.toLowerCase() });
  }
  return out;
}

function extractValueFromBody(body) {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "value" in parsed) {
      return parsed.value;
    }
    return parsed;
  } catch (_) {
    return body;
  }
}

function setParamStatus(el, text, state) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove("param-result-ok", "param-result-error");
  if (state) {
    el.classList.add(state === "ok" ? "param-result-ok" : "param-result-error");
  }
}

async function loadServerConfig() {
  try {
    const res = await fetch("/config");
    if (!res.ok) return;
    const data = await res.json();
    if (gridXInput && document.activeElement !== gridXInput && data.grid_x != null) {
      gridXInput.value = `${data.grid_x}`;
    }
    if (gridYInput && document.activeElement !== gridYInput && data.grid_y != null) {
      gridYInput.value = `${data.grid_y}`;
    }
    if (detectorIpInput && document.activeElement !== detectorIpInput && data.detector_ip) {
      detectorIpInput.value = data.detector_ip;
    }
    if (detectorZmqPortInput && document.activeElement !== detectorZmqPortInput && data.zmq_port) {
      detectorZmqPortInput.value = `${data.zmq_port}`;
    }
    if (detectorApiPortInput && document.activeElement !== detectorApiPortInput && data.api_port) {
      detectorApiPortInput.value = `${data.api_port}`;
    }
  } catch (_) {
    // ignore
  }
}

function buildParamRow(moduleId, sectionId, param) {
  const effectiveModule = param.module || moduleId;
  const effectiveSection = param.section || sectionId;
  const row = document.createElement("div");
  row.className = "param-row";
  row.dataset.paramName = param.name.toLowerCase();
  row.dataset.paramModule = effectiveModule;
  row.dataset.paramKind = effectiveSection;

  const info = document.createElement("div");
  info.className = "param-info";
  const nameEl = document.createElement("div");
  nameEl.className = "param-name";
  nameEl.textContent = param.name;
  if (param.remarks) {
    const help = document.createElement("span");
    help.className = "param-help";
    help.textContent = "?";
    help.title = param.remarks;
    nameEl.appendChild(help);
  }
  const meta = document.createElement("div");
  meta.className = "param-meta";
  const typeLabel = param.type ? param.type : "command";
  const accessLabel = param.access ? param.access.toUpperCase() : "";
  meta.textContent = [typeLabel, accessLabel].filter(Boolean).join(" · ");
  info.appendChild(nameEl);
  info.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "param-actions";

  const result = document.createElement("div");
  result.className = "param-result";

  const access = param.access || "";
  const canRead = access.includes("r");
  const canWrite = access.includes("w");

  if (effectiveSection === "command") {
    const btn = document.createElement("button");
    btn.className = "export-btn param-btn";
    btn.textContent = "Run";
    btn.addEventListener("click", async () => {
      if (effectiveModule === "system") {
        const ok = window.confirm(`Run system command ${param.name}?`);
        if (!ok) return;
      }
      setParamStatus(result, "Sending…");
      try {
        const res = await fetch(`/simplon/${effectiveModule}/command/${encodeParamPath(param.name)}`, {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) {
          setParamStatus(result, "Queued", "ok");
        } else {
          setParamStatus(result, `Failed (${data.status || res.status})`, "error");
        }
      } catch (_) {
        setParamStatus(result, "Failed", "error");
      }
    });
    actions.appendChild(btn);
  } else if (effectiveSection === "images") {
    const link = document.createElement("button");
    link.className = "export-btn param-btn";
    link.textContent = "Open";
    link.addEventListener("click", () => {
      const url = `/simplon/${effectiveModule}/images/${encodeParamPath(param.name)}`;
      window.open(url, "_blank", "noopener");
    });
    actions.appendChild(link);
  } else {
    let input = null;
    if (effectiveSection === "config") {
      input = document.createElement("input");
      input.className = "param-input";
      input.type = "text";
      input.placeholder = param.type || "value";
      actions.appendChild(input);
    }
    if (canWrite && effectiveSection === "config") {
      const setBtn = document.createElement("button");
      setBtn.className = "export-btn param-btn";
      setBtn.textContent = "Set";
      setBtn.addEventListener("click", async () => {
        if (!input) return;
        const parsed = parseParamValue(input.value);
        if (!parsed.ok) {
          setParamStatus(result, parsed.error, "error");
          return;
        }
        setParamStatus(result, "Sending…");
        try {
          const res = await fetch(`/simplon/${effectiveModule}/config/${encodeParamPath(param.name)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: parsed.value }),
          });
          const data = await res.json().catch(() => ({}));
          if (data.ok) {
            setParamStatus(result, "Saved", "ok");
          } else {
            setParamStatus(result, `Failed (${data.status || res.status})`, "error");
          }
        } catch (_) {
          setParamStatus(result, "Failed", "error");
        }
      });
      actions.appendChild(setBtn);
    }
    if (canRead) {
      const getBtn = document.createElement("button");
      getBtn.className = "export-btn param-btn";
      getBtn.textContent = "Get";
      getBtn.addEventListener("click", async () => {
        setParamStatus(result, "Loading…");
        try {
          const res = await fetch(`/simplon/${effectiveModule}/${effectiveSection}/${encodeParamPath(param.name)}`);
          const data = await res.json().catch(() => ({}));
          if (data.ok) {
            const value = extractValueFromBody(data.body);
            if (input && effectiveSection === "config") {
              if (typeof value === "string") {
                input.value = value;
              } else {
                input.value = JSON.stringify(value);
              }
            }
            setParamStatus(result, formatParamResult(data.body), "ok");
          } else {
            setParamStatus(result, `Failed (${data.status || res.status})`, "error");
          }
        } catch (_) {
          setParamStatus(result, "Failed", "error");
        }
      });
      actions.appendChild(getBtn);
    }
  }

  row.appendChild(info);
  row.appendChild(actions);
  row.appendChild(result);
  return row;
}

function renderParamBrowser(defs) {
  if (!paramBrowser) return;
  paramBrowser.innerHTML = "";
  paramRows = [];
  paramSections = [];
  paramModules = [];
  const commonModule = buildCommonModule(defs.modules || []);
  const modules = commonModule ? [commonModule, ...(defs.modules || [])] : defs.modules || [];
  modules.forEach((module) => {
    const moduleDetails = document.createElement("details");
    moduleDetails.className = "param-module";
    moduleDetails.open = module.id === "common";
    const moduleSummary = document.createElement("summary");
    moduleSummary.textContent = module.label || module.id;
    moduleDetails.appendChild(moduleSummary);

    const moduleBody = document.createElement("div");
    moduleBody.className = "param-module-body";
    (module.sections || []).forEach((section) => {
      const sectionDetails = document.createElement("details");
      sectionDetails.className = "param-section";
      sectionDetails.open = module.id === "common";
      const sectionSummary = document.createElement("summary");
      const count = Array.isArray(section.params) ? section.params.length : 0;
      sectionSummary.textContent = `${section.label || section.id} (${count})`;
      sectionDetails.appendChild(sectionSummary);

      const list = document.createElement("div");
      list.className = "param-list";
      const rows = [];
      (section.params || []).forEach((param) => {
        const row = buildParamRow(module.id, section.id, param);
        list.appendChild(row);
        rows.push(row);
        paramRows.push(row);
      });
      sectionDetails.appendChild(list);
      moduleBody.appendChild(sectionDetails);
      paramSections.push({ el: sectionDetails, module: module.id, kind: section.id, rows });
    });
    moduleDetails.appendChild(moduleBody);
    paramBrowser.appendChild(moduleDetails);
    paramModules.push({ el: moduleDetails, module: module.id });
  });
  applyParamFilters();
}

function buildCommonModule(modules) {
  const favorites = currentFavorites.length ? currentFavorites : defaultParamFavorites;
  if (!Array.isArray(modules) || favorites.length === 0) {
    return null;
  }
  const index = new Map();
  modules.forEach((module) => {
    (module.sections || []).forEach((section) => {
      (section.params || []).forEach((param) => {
        const key = `${module.id}|${section.id}|${param.name}`;
        index.set(key, param);
      });
    });
  });

  const sectionMap = new Map();
  favorites.forEach((fav) => {
    const key = `${fav.module}|${fav.section}|${fav.name}`;
    const param = index.get(key);
    if (!param) return;
    const listKey = `${fav.section}`;
    if (!sectionMap.has(listKey)) {
      sectionMap.set(listKey, []);
    }
    sectionMap.get(listKey).push({ ...param, module: fav.module, section: fav.section });
  });

  if (sectionMap.size === 0) {
    return null;
  }

  const order = ["command", "config", "status", "images"];
  const sections = [];
  order.forEach((id) => {
    const params = sectionMap.get(id);
    if (!params || params.length === 0) return;
    sections.push({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      params,
    });
  });

  return {
    id: "common",
    label: "Common",
    sections,
  };
}

function applyParamFilters() {
  if (!paramBrowser) return;
  const query = paramSearchInput?.value.trim().toLowerCase() || "";
  const showConfig = paramFilterConfig?.checked ?? true;
  const showStatus = paramFilterStatus?.checked ?? true;
  const showCommand = paramFilterCommand?.checked ?? true;
  const showImages = paramFilterImages?.checked ?? true;
  const showFavoritesOnly = paramFavoritesOnly?.checked ?? false;
  const kindVisible = {
    config: showConfig,
    status: showStatus,
    command: showCommand,
    images: showImages,
  };

  paramSections.forEach((section) => {
    const showKind = kindVisible[section.kind] ?? true;
    let visibleCount = 0;
    section.rows.forEach((row) => {
      const name = row.dataset.paramName || "";
      const module = (row.dataset.paramModule || "").toLowerCase();
      const kind = (row.dataset.paramKind || "").toLowerCase();
      const key = `${module}|${kind}|${row.dataset.paramName || ""}`;
      const matches = !query || name.includes(query) || module.includes(query);
      const isFavorite = currentFavoriteSet.has(key);
      const visible = showKind && matches && (!showFavoritesOnly || isFavorite);
      row.classList.toggle("is-hidden", !visible);
      if (visible) visibleCount += 1;
    });
    const sectionVisible = showKind && visibleCount > 0;
    section.el.classList.toggle("is-hidden", !sectionVisible);
    if (query && sectionVisible) {
      section.el.open = true;
    }
  });

  paramModules.forEach((module) => {
    const visible = paramSections.some((section) => section.module === module.module && !section.el.classList.contains("is-hidden"));
    module.el.classList.toggle("is-hidden", !visible);
    if (query && visible) {
      module.el.open = true;
    }
  });
}

async function loadParamDefinitions() {
  if (!paramBrowser) return;
  paramBrowser.innerHTML = "<div class=\"panel-hint\">Loading parameters…</div>";
  try {
    const res = await fetch("/params.json");
    if (!res.ok) {
      throw new Error("failed");
    }
    const data = await res.json();
    paramDefs = data;
    const stored = localStorage.getItem("paramFavorites");
    if (stored) {
      try {
        currentFavorites = JSON.parse(stored) || [];
      } catch (_) {
        currentFavorites = [];
      }
    }
    currentFavoriteSet = buildFavoriteSet(currentFavorites.length ? currentFavorites : defaultParamFavorites);
    renderParamBrowser(data);
  } catch (_) {
    paramBrowser.innerHTML = "<div class=\"panel-hint\">Failed to load parameters.</div>";
  }
}

paramSearchInput?.addEventListener("input", applyParamFilters);
paramFilterConfig?.addEventListener("change", applyParamFilters);
paramFilterStatus?.addEventListener("change", applyParamFilters);
paramFilterCommand?.addEventListener("change", applyParamFilters);
paramFilterImages?.addEventListener("change", applyParamFilters);
paramFavoritesOnly?.addEventListener("change", applyParamFilters);
paramExpandBtn?.addEventListener("click", () => {
  paramModules.forEach((module) => {
    module.el.open = true;
  });
  paramSections.forEach((section) => {
    section.el.open = true;
  });
});
paramCollapseBtn?.addEventListener("click", () => {
  paramModules.forEach((module) => {
    module.el.open = false;
  });
  paramSections.forEach((section) => {
    section.el.open = false;
  });
});

paramFavoritesEditBtn?.addEventListener("click", () => {
  if (!paramFavoritesEditor || !paramFavoritesText) return;
  paramFavoritesEditor.classList.toggle("is-hidden");
  if (!paramFavoritesEditor.classList.contains("is-hidden")) {
    paramFavoritesText.value = formatFavorites(currentFavorites.length ? currentFavorites : defaultParamFavorites);
  }
});

paramFavoritesCancel?.addEventListener("click", () => {
  paramFavoritesEditor?.classList.add("is-hidden");
});

paramFavoritesSave?.addEventListener("click", () => {
  if (!paramFavoritesText) return;
  const parsed = parseFavoritesInput(paramFavoritesText.value);
  currentFavorites = parsed;
  currentFavoriteSet = buildFavoriteSet(currentFavorites);
  localStorage.setItem("paramFavorites", JSON.stringify(currentFavorites));
  if (paramDefs) {
    renderParamBrowser(paramDefs);
  } else {
    applyParamFilters();
  }
  paramFavoritesEditor?.classList.add("is-hidden");
});
let histogramThreshold = "";
let histogramDirty = false;
let histogramDrag = null;
let minZoom = 0.5;

updateContrastControls();
updatePanelPadding();
startStatusPolling();
attachHistogramInteractions();
updateFooterPadding();
scheduleLayoutRefresh();
setupLayoutObserver();
loadParamDefinitions();
loadServerConfig();

exportSnapshotBtn?.addEventListener("click", () => {
  exportSnapshot();
});

function createPlot(threshold) {
  const container = document.createElement("div");
  container.className = "plot";
  const controls = document.createElement("div");
  controls.className = "plot-controls";
  const title = document.createElement("h2");
  title.textContent = threshold;
  const exportBtn = document.createElement("button");
  exportBtn.className = "export-btn export-icon";
  exportBtn.innerHTML = "<span class=\"icon\">⬇︎</span><span>PNG</span>";
  exportBtn.title = "Export PNG";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "canvas-wrap";
  const colorbarWrap = document.createElement("div");
  colorbarWrap.className = "colorbar-stack";
  const canvasInner = document.createElement("div");
  canvasInner.className = "canvas-inner";
  const gridOverlay = document.createElement("div");
  gridOverlay.className = "grid-overlay";
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  const pixelLabels = document.createElement("div");
  pixelLabels.className = "pixel-labels";

  canvas.width = gridX;
  canvas.height = gridY;

  const imageData = ctx.createImageData(gridX, gridY);
  const maxValue = { value: 1 };
  const minValue = { value: 0 };
  const values = new Uint32Array(gridX * gridY);
  const basePixel = { value: 12 };
  const zoom = { value: 1 };
  const xSums = new Float64Array(gridX);
  const ySums = new Float64Array(gridY);
  const rowCounts = new Uint32Array(gridY);
  const wrapSize = { width: 0, height: 0 };
  const projectionDirty = { value: false };

  const plotBody = document.createElement("div");
  plotBody.className = "plot-body";
  const yProjection = document.createElement("canvas");
  yProjection.className = "projection projection-y";
  const yProjectionCtx = yProjection.getContext("2d");
  const xProjection = document.createElement("canvas");
  xProjection.className = "projection projection-x";
  const xProjectionCtx = xProjection.getContext("2d");
  const projectionRow = document.createElement("div");
  projectionRow.className = "projection-row";
  const projectionSpacerLeft = document.createElement("div");
  projectionSpacerLeft.className = "projection-spacer-left";
  const projectionSpacer = document.createElement("div");
  projectionSpacer.className = "projection-spacer";

  controls.appendChild(title);
  controls.appendChild(exportBtn);
  container.appendChild(controls);
  canvasInner.appendChild(canvas);
  canvasInner.appendChild(gridOverlay);
  canvasInner.appendChild(pixelLabels);
  canvasWrap.appendChild(canvasInner);
  canvasWrap.appendChild(tooltip);
  plotBody.appendChild(colorbarWrap);
  plotBody.appendChild(canvasWrap);
  plotBody.appendChild(yProjection);
  container.appendChild(plotBody);
  projectionRow.appendChild(xProjection);
  projectionRow.appendChild(projectionSpacer);
  projectionRow.insertBefore(projectionSpacerLeft, xProjection);
  container.appendChild(projectionRow);

  const colorbar = document.createElement("div");
  colorbar.className = "colorbar";
  colorbar.style.background = gradientFromScheme(currentScheme, true);
  const minLabel = document.createElement("span");
  minLabel.className = "colorbar-label";
  minLabel.textContent = "0";
  const maxLabel = document.createElement("span");
  maxLabel.className = "colorbar-label";
  maxLabel.textContent = "0";
  colorbarWrap.appendChild(colorbar);
  colorbarWrap.insertBefore(maxLabel, colorbar);
  colorbarWrap.appendChild(minLabel);
  plotsEl.appendChild(container);

  exportBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = `${threshold}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  canvasWrap.addEventListener("mousemove", (event) => {
    const rect = canvasWrap.getBoundingClientRect();
    const pixelSize = basePixel.value * (syncViewsToggle?.checked ? globalZoom : zoom.value);
    const xPx = event.clientX - rect.left + canvasWrap.scrollLeft;
    const yPx = event.clientY - rect.top + canvasWrap.scrollTop;
    const x = Math.floor(xPx / pixelSize);
    const y = Math.floor(yPx / pixelSize);
    if (x < 0 || y < 0 || x >= gridX || y >= gridY) {
      tooltip.style.display = "none";
      return;
    }
    const idx = y * gridX + x;
    tooltip.textContent = `x:${x} y:${y} v:${values[idx]}`;
    tooltip.style.display = "block";
    tooltip.style.left = `${event.clientX - rect.left}px`;
    tooltip.style.top = `${event.clientY - rect.top}px`;
  });

  canvasWrap.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
  });

  canvasWrap.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    const nextZoom = Math.min(8, Math.max(0.5, (syncViewsToggle?.checked ? globalZoom : zoom.value) + delta));
    if (syncViewsToggle?.checked) {
      setGlobalZoom(nextZoom);
    } else {
      setPlotZoom({ zoom, canvas, canvasInner, gridOverlay, basePixel, canvasWrap }, nextZoom);
    }
  }, { passive: false });

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let startScrollLeft = 0;
  let startScrollTop = 0;

  canvasWrap.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    startScrollLeft = canvasWrap.scrollLeft;
    startScrollTop = canvasWrap.scrollTop;
    canvasWrap.style.cursor = "grabbing";
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
    canvasWrap.style.cursor = "default";
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    canvasWrap.scrollLeft = startScrollLeft - dx;
    canvasWrap.scrollTop = startScrollTop - dy;
  });

  canvasWrap.addEventListener("dblclick", (event) => {
    event.preventDefault();
    const factor = event.shiftKey ? 0.8 : 1.25;
    const nextZoom = Math.min(8, Math.max(0.5, (syncViewsToggle?.checked ? globalZoom : zoom.value) * factor));
    if (syncViewsToggle?.checked) {
      setGlobalZoom(nextZoom);
    } else {
      setPlotZoom({ zoom, canvas, canvasInner, gridOverlay, basePixel, canvasWrap }, nextZoom);
    }
  });

  plots.set(threshold, {
    canvas,
    ctx,
    imageData,
    maxValue,
    minValue,
    minLabel,
    maxLabel,
    values,
    xSums,
    ySums,
    rowCounts,
    projectionDirty,
    xProjection,
    xProjectionCtx,
    yProjection,
    yProjectionCtx,
    container,
    controls,
    plotBody,
    projectionRow,
    labelTop: maxLabel,
    labelBottom: minLabel,
    colorbarWrap,
    projectionSpacerLeft,
    wrapSize,
    basePixel,
    zoom,
    canvasWrap,
    canvasInner,
    gridOverlay,
    pixelLabels,
    colorbar,
  });

  canvasWrap.addEventListener("scroll", () => {
    if (!syncViewsToggle?.checked) {
      return;
    }
    const left = canvasWrap.scrollLeft;
    const top = canvasWrap.scrollTop;
    plots.forEach((other) => {
      if (other.canvasWrap !== canvasWrap) {
        other.canvasWrap.scrollLeft = left;
        other.canvasWrap.scrollTop = top;
      }
    });
  });
}

function updatePixel(threshold, imageId, value) {
  const plot = plots.get(threshold);
  if (!plot) return;

  const prev = plot.values[imageId];
  plot.values[imageId] = value;
  const delta = value - prev;
  if (plot.maxValue.value === 1 && plot.minValue.value === 0) {
    plot.minValue.value = value;
    plot.maxValue.value = value;
  }
  if (value > plot.maxValue.value) {
    plot.maxValue.value = value;
  }
  if (value < plot.minValue.value) {
    plot.minValue.value = value;
  }
  if (autoscaleToggle.checked) {
    plot.minLabel.textContent = `${plot.minValue.value}`;
    plot.maxLabel.textContent = `${plot.maxValue.value}`;
  } else {
    plot.minLabel.textContent = `${manualMin}`;
    plot.maxLabel.textContent = `${manualMax}`;
  }
  const x = imageId % gridX;
  const y = Math.floor(imageId / gridX);
  const idx = (y * gridX + x) * 4;
  plot.xSums[x] += delta;
  plot.ySums[y] += delta;
  if (prev === 0) {
    plot.rowCounts[y] += 1;
  }
  let minVal = plot.minValue.value;
  let maxVal = plot.maxValue.value;
  if (!autoscaleToggle.checked) {
    minVal = manualMin;
    maxVal = manualMax;
  }
  const denom = Math.max(1, maxVal - minVal);
  const norm = (value - minVal) / denom;
  const intensity = Math.min(255, Math.floor(norm * 255));
  const [r, g, b] = colorFromScheme(intensity / 255, currentScheme);

  plot.imageData.data[idx] = r;
  plot.imageData.data[idx + 1] = g;
  plot.imageData.data[idx + 2] = b;
  plot.imageData.data[idx + 3] = 255;
  plot.ctx.putImageData(plot.imageData, 0, 0);
  scheduleProjectionUpdate(plot);
}

function applySnapshot(threshold, payload) {
  const plot = plots.get(threshold);
  if (!plot || !payload) return;

  const values = payload.values;
  const mask = payload.mask;
  const total = gridX * gridY;
  if (!Array.isArray(values) || values.length < total) {
    return;
  }

  plot.xSums.fill(0);
  plot.ySums.fill(0);
  plot.rowCounts.fill(0);

  let minVal = Number.POSITIVE_INFINITY;
  let maxVal = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < total; i++) {
    const value = values[i] || 0;
    const valid = Array.isArray(mask) ? Boolean(mask[i]) : true;
    plot.values[i] = value;
    if (valid) {
      if (value < minVal) minVal = value;
      if (value > maxVal) maxVal = value;
      const x = i % gridX;
      const y = Math.floor(i / gridX);
      plot.xSums[x] += value;
      plot.ySums[y] += value;
      plot.rowCounts[y] += 1;
    }
  }

  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) {
    minVal = 0;
    maxVal = 1;
  }
  plot.minValue.value = minVal;
  plot.maxValue.value = maxVal;

  let renderMin = minVal;
  let renderMax = maxVal;
  if (!autoscaleToggle.checked) {
    renderMin = manualMin;
    renderMax = manualMax;
  }
  if (autoscaleToggle.checked) {
    plot.minLabel.textContent = `${plot.minValue.value}`;
    plot.maxLabel.textContent = `${plot.maxValue.value}`;
  } else {
    plot.minLabel.textContent = `${manualMin}`;
    plot.maxLabel.textContent = `${manualMax}`;
  }

  const denom = Math.max(1, renderMax - renderMin);
  for (let i = 0; i < total; i++) {
    const value = plot.values[i];
    const norm = Math.min(1, Math.max(0, (value - renderMin) / denom));
    const [r, g, b] = colorFromScheme(norm, currentScheme);
    const idx = i * 4;
    plot.imageData.data[idx] = r;
    plot.imageData.data[idx + 1] = g;
    plot.imageData.data[idx + 2] = b;
    plot.imageData.data[idx + 3] = 255;
  }
  plot.ctx.putImageData(plot.imageData, 0, 0);
  scheduleProjectionUpdate(plot);
}

let ws = null;
let wsReconnectTimer = null;

function connectWebSocket() {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${location.host}/ws`;
  ws = new WebSocket(url);
  ws.addEventListener("open", () => {
    statusEl.textContent = "Connected";
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "snapshot_request" }));
    }
  });
  ws.addEventListener("close", () => {
    statusEl.textContent = "Disconnected";
    setStatus(detectorStatusEl, "na");
    setStatus(streamStatusEl, "na");
    setStatus(filewriterStatusEl, "na");
    setStatus(monitorStatusEl, "na");
    if (!wsReconnectTimer) {
      wsReconnectTimer = window.setTimeout(() => {
        wsReconnectTimer = null;
        connectWebSocket();
      }, 2000);
    }
  });
  ws.addEventListener("error", () => {
    statusEl.textContent = "WebSocket error";
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
  if (msg.type === "config") {
    gridX = msg.grid_x;
    gridY = msg.grid_y;
    if (gridXInput && document.activeElement !== gridXInput) {
      gridXInput.value = `${gridX}`;
    }
    if (gridYInput && document.activeElement !== gridYInput) {
      gridYInput.value = `${gridY}`;
    }
    plotsEl.innerHTML = "";
    (msg.thresholds || []).forEach(createPlot);
    histogramThreshold = (msg.thresholds || [])[0] || "";
    plots.forEach((plot) => {
      const rect = plot.canvasWrap.getBoundingClientRect();
      plot.basePixel.value = Math.max(6, Math.floor(rect.width / gridX));
      plot.wrapSize.width = rect.width;
      plot.wrapSize.height = rect.height;
      plot.canvasWrap.style.width = "";
      plot.canvasWrap.style.height = "";
      updatePlotScale(plot);
    });
    scheduleHistogramUpdate();
    scheduleLayoutRefresh();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "snapshot_request" }));
    }
    return;
  }

  if (msg.type === "snapshot") {
    if (!gridX || !gridY) return;
    Object.entries(msg.data || {}).forEach(([threshold, payload]) => {
      applySnapshot(threshold, payload);
    });
    plots.forEach((plot) => updatePixelLabels(plot));
    scheduleHistogramUpdate();

    frameCount += 1;
    const now = performance.now();
    if (now - lastFrameTime >= 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastFrameTime));
      fpsEl.textContent = `UI ${fps} Hz`;
      frameCount = 0;
      lastFrameTime = now;
    }
    return;
  }

  if (!gridX || !gridY) return;
  const imageId = msg.image_id;
  Object.entries(msg.data || {}).forEach(([threshold, value]) => {
    updatePixel(threshold, imageId, value);
  });

  plots.forEach((plot) => updatePixelLabels(plot));
  scheduleHistogramUpdate();

  frameCount += 1;
  const now = performance.now();
  if (now - lastFrameTime >= 1000) {
    const fps = Math.round((frameCount * 1000) / (now - lastFrameTime));
    fpsEl.textContent = `UI ${fps} Hz`;
    frameCount = 0;
    lastFrameTime = now;
  }
  });
}

connectWebSocket();

function updatePlotScale(plot) {
  const wrapWidth = plot.canvasWrap.clientWidth;
  if (wrapWidth && plot.container) {
    const computed = getComputedStyle(plot.container);
    const paddingY = parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom);
    const gap = parseFloat(computed.rowGap || computed.gap || 0);
    const controlsHeight = plot.controls?.offsetHeight || 0;
    const projectionHeight = plot.projectionRow?.offsetHeight || 0;
    const gaps = gap * 2;
    const available = Math.max(
      120,
      plot.container.clientHeight - paddingY - controlsHeight - projectionHeight - gaps
    );
    const targetHeight = Math.min(wrapWidth, available);
    plot.plotBody.style.height = `${targetHeight}px`;
    plot.canvasWrap.style.height = `${targetHeight}px`;
    plot.basePixel.value = Math.max(6, Math.floor(targetHeight / gridX));
  }

  const minForPlot = computeMinZoom(plot);
  if (syncViewsToggle?.checked) {
    if (globalZoom < minForPlot) {
      globalZoom = minForPlot;
    }
  } else if (plot.zoom.value < minForPlot) {
    plot.zoom.value = minForPlot;
  }
  const pixelSize = plot.basePixel.value * (syncViewsToggle?.checked ? globalZoom : plot.zoom.value);
  const widthPx = gridX * pixelSize;
  const heightPx = gridY * pixelSize;
  plot.canvas.width = gridX;
  plot.canvas.height = gridY;
  plot.canvas.style.width = `${widthPx}px`;
  plot.canvas.style.height = `${heightPx}px`;
  plot.canvasInner.style.width = `${widthPx}px`;
  plot.canvasInner.style.height = `${heightPx}px`;
  if (plot.canvasInner) {
    plot.canvasInner.style.width = `${widthPx}px`;
    plot.canvasInner.style.height = `${heightPx}px`;
  }
  plot.gridOverlay.style.backgroundSize = `${pixelSize}px ${pixelSize}px`;
  plot.wrapSize.width = plot.canvasWrap.clientWidth;
  plot.wrapSize.height = plot.canvasWrap.clientHeight;
  if (plot.xProjection) {
    const targetWidth = plot.wrapSize.width || plot.canvasWrap.clientWidth || widthPx;
    plot.xProjection.style.width = `${targetWidth}px`;
  }
  if (plot.projectionSpacerLeft && plot.colorbarWrap) {
    plot.projectionSpacerLeft.style.width = `${plot.colorbarWrap.offsetWidth}px`;
  }
  if (plot.colorbar && plot.colorbarWrap) {
    plot.colorbar.style.height = `${plot.canvasWrap.clientHeight}px`;
    plot.colorbarWrap.style.height = `${plot.canvasWrap.clientHeight}px`;
  }
  updateZoomBounds();
  updatePixelLabels(plot);
  scheduleProjectionUpdate(plot);
}

function setGlobalZoom(value) {
  const minAllowed = getMinZoomForPlots();
  globalZoom = Math.max(minAllowed, value);
  plots.forEach((plot) => updatePlotScale(plot));
  if (zoomLevelEl) {
    zoomLevelEl.textContent = `${globalZoom.toFixed(1)}x`;
  }
  if (zoomSlider) {
    zoomSlider.value = globalZoom.toFixed(1);
  }
}

function setPlotZoom(plot, value) {
  const minAllowed = computeMinZoom(plot);
  plot.zoom.value = Math.max(minAllowed, value);
  updatePlotScale(plot);
}

zoomInBtn?.addEventListener("click", () => {
  setGlobalZoom(Math.min(8, Math.max(0.5, globalZoom * 1.25)));
});

zoomOutBtn?.addEventListener("click", () => {
  setGlobalZoom(Math.min(8, Math.max(minZoom, globalZoom * 0.8)));
});

zoomResetBtn?.addEventListener("click", () => {
  setGlobalZoom(Math.max(1, minZoom));
});

zoomSlider?.addEventListener("input", (event) => {
  const value = parseFloat(event.target.value);
  if (Number.isFinite(value)) {
    setGlobalZoom(Math.min(8, Math.max(minZoom, value)));
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "+" || event.key === "=") {
    setGlobalZoom(Math.min(8, Math.max(0.5, globalZoom * 1.25)));
  } else if (event.key === "-" || event.key === "_") {
    setGlobalZoom(Math.min(8, Math.max(minZoom, globalZoom * 0.8)));
  } else if (event.key === "0") {
    setGlobalZoom(Math.max(1, minZoom));
  }
});

const activePointers = new Map();
let pinchStartDist = null;
let pinchStartZoom = null;

function pointerDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

plotsContainer?.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch") return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size === 2) {
    const points = Array.from(activePointers.values());
    pinchStartDist = pointerDistance(points[0], points[1]);
    pinchStartZoom = globalZoom;
    plotsContainer.style.touchAction = "none";
    if (syncViewsToggle && !syncViewsToggle.checked) {
      syncViewsToggle.checked = true;
      syncViewsToggle.dispatchEvent(new Event("change"));
    }
  }
});

plotsContainer?.addEventListener("pointermove", (event) => {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size === 2 && pinchStartDist && pinchStartZoom != null) {
    event.preventDefault();
    const points = Array.from(activePointers.values());
    const dist = pointerDistance(points[0], points[1]);
    if (pinchStartDist > 0) {
      const nextZoom = pinchStartZoom * (dist / pinchStartDist);
      setGlobalZoom(Math.min(8, Math.max(minZoom, nextZoom)));
    }
  }
});

function endPointer(event) {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.delete(event.pointerId);
  if (activePointers.size < 2) {
    pinchStartDist = null;
    pinchStartZoom = null;
    plotsContainer.style.touchAction = "pan-x pan-y";
  }
}

plotsContainer?.addEventListener("pointerup", endPointer);
plotsContainer?.addEventListener("pointercancel", endPointer);

colorSchemeSelect?.addEventListener("change", () => {
  currentScheme = colorSchemeSelect.value;
  plots.forEach((plot) => redrawPlot(plot));
  scheduleHistogramUpdate();
});

autoscaleToggle?.addEventListener("change", () => {
  plots.forEach((plot) => redrawPlot(plot));
  updateContrastControls();
  scheduleHistogramUpdate();
});

histogramLogToggle?.addEventListener("change", () => {
  scheduleHistogramUpdate();
});

let resizing = false;
let startX = 0;
let startWidth = 0;
let moved = false;

panelHandle?.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  moved = false;
  resizing = true;
  startX = event.clientX;
  startWidth = controlPanel ? controlPanel.getBoundingClientRect().width : 260;
  panelHandle.setPointerCapture?.(event.pointerId);
});

window.addEventListener("pointermove", (event) => {
  if (!resizing || !controlPanel) return;
  const delta = startX - event.clientX;
  if (Math.abs(delta) > 6) {
    moved = true;
  }
  const nextWidth = Math.min(420, Math.max(200, startWidth + delta));
  controlPanel.style.width = `${nextWidth}px`;
  controlPanel.classList.add("panel-open");
  document.body.style.setProperty("--panel-width", `${nextWidth}px`);
  updatePanelPadding();
  scheduleHistogramUpdate();
  plots.forEach((plot) => scheduleProjectionUpdate(plot));
});

window.addEventListener("pointerup", (event) => {
  if (!resizing) return;
  panelHandle?.releasePointerCapture?.(event.pointerId);
  if (!moved) {
    controlPanel?.classList.toggle("panel-open");
    updatePanelPadding();
  }
  resizing = false;
});

window.addEventListener("pointercancel", (event) => {
  if (!resizing) return;
  panelHandle?.releasePointerCapture?.(event.pointerId);
  resizing = false;
});

window.addEventListener("resize", () => {
  scheduleHistogramUpdate();
  plots.forEach((plot) => scheduleProjectionUpdate(plot));
  updateFooterPadding();
});

function updatePanelPadding() {
  const isOpen = controlPanel?.classList.contains("panel-open");
  if (isOpen) {
    document.body.classList.add("panel-opened");
    const width = controlPanel?.getBoundingClientRect().width || 260;
    document.body.style.setProperty("--panel-width", `${width}px`);
  } else {
    document.body.classList.remove("panel-opened");
  }
}

function closePanelIfMobile() {
  if (!controlPanel || !isMobile()) {
    return;
  }
  if (controlPanel.classList.contains("panel-open")) {
    controlPanel.classList.remove("panel-open");
    updatePanelPadding();
  }
}

controlPanel?.addEventListener("click", (event) => {
  const target = event.target;
  if (!target) return;
  if (target.closest("[data-panel-tab]")) {
    return;
  }
});

contrastMin?.addEventListener("input", () => {
  manualMin = Math.min(parseInt(contrastMin.value, 10), manualMax - 1);
  contrastMin.value = `${manualMin}`;
  if (contrastMinValue) contrastMinValue.textContent = `${manualMin}`;
  plots.forEach((plot) => redrawPlot(plot));
  scheduleHistogramUpdate();
});

contrastMax?.addEventListener("input", () => {
  manualMax = Math.max(parseInt(contrastMax.value, 10), manualMin + 1);
  contrastMax.value = `${manualMax}`;
  if (contrastMaxValue) contrastMaxValue.textContent = `${manualMax}`;
  plots.forEach((plot) => redrawPlot(plot));
  scheduleHistogramUpdate();
});

function redrawPlot(plot) {
  let minVal = plot.minValue.value;
  let maxVal = plot.maxValue.value;
  if (!autoscaleToggle.checked) {
    minVal = manualMin;
    maxVal = manualMax;
  }
  if (autoscaleToggle.checked) {
    plot.minLabel.textContent = `${plot.minValue.value}`;
    plot.maxLabel.textContent = `${plot.maxValue.value}`;
  } else {
    plot.minLabel.textContent = `${manualMin}`;
    plot.maxLabel.textContent = `${manualMax}`;
  }
  const denom = Math.max(1, maxVal - minVal);
  for (let i = 0; i < plot.values.length; i++) {
    const value = plot.values[i];
    const norm = (value - minVal) / denom;
    const [r, g, b] = colorFromScheme(norm, currentScheme);
    const idx = i * 4;
    plot.imageData.data[idx] = r;
    plot.imageData.data[idx + 1] = g;
    plot.imageData.data[idx + 2] = b;
    plot.imageData.data[idx + 3] = 255;
  }
  plot.ctx.putImageData(plot.imageData, 0, 0);
  if (plot.colorbar) {
    plot.colorbar.style.background = gradientFromScheme(currentScheme, true);
  }
  updatePixelLabels(plot);
  scheduleHistogramUpdate();
  scheduleProjectionUpdate(plot);
}

function updateContrastControls() {
  const disabled = autoscaleToggle?.checked;
  if (contrastMin) contrastMin.disabled = disabled;
  if (contrastMax) contrastMax.disabled = disabled;
  if (contrastMinValue) contrastMinValue.textContent = `${manualMin}`;
  if (contrastMaxValue) contrastMaxValue.textContent = `${manualMax}`;
}

function scheduleHistogramUpdate() {
  if (!histogramCanvas || !histogramCtx || histogramDirty) {
    return;
  }
  histogramDirty = true;
  const delay = isMobile() ? 120 : 0;
  if (delay > 0) {
    setTimeout(() => {
      histogramDirty = false;
      renderHistogram();
    }, delay);
  } else {
    requestAnimationFrame(() => {
      histogramDirty = false;
      renderHistogram();
    });
  }
}

function attachHistogramInteractions() {
  if (!histogramCanvas) {
    return;
  }
  histogramCanvas.addEventListener("pointerdown", (event) => {
    const plot = getHistogramPlot();
    if (!plot) return;
    const { minVal, maxVal } = histogramRange(plot);
    const rect = histogramCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const t = Math.min(1, Math.max(0, x / rect.width));
    const value = minVal + t * (maxVal - minVal);
    const leftVal = autoscaleToggle.checked ? minVal : manualMin;
    const rightVal = autoscaleToggle.checked ? maxVal : manualMax;
    const distMin = Math.abs(value - leftVal);
    const distMax = Math.abs(value - rightVal);
    histogramDrag = distMin <= distMax ? "min" : "max";
    histogramCanvas.setPointerCapture(event.pointerId);
    applyHistogramValue(plot, histogramDrag, value);
  });

  histogramCanvas.addEventListener("pointermove", (event) => {
    if (!histogramDrag) return;
    const plot = getHistogramPlot();
    if (!plot) return;
    const { minVal, maxVal } = histogramRange(plot);
    const rect = histogramCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const t = Math.min(1, Math.max(0, x / rect.width));
    const value = minVal + t * (maxVal - minVal);
    applyHistogramValue(plot, histogramDrag, value);
  });

  histogramCanvas.addEventListener("pointerup", (event) => {
    if (histogramDrag) {
      histogramCanvas.releasePointerCapture(event.pointerId);
    }
    histogramDrag = null;
  });

  histogramCanvas.addEventListener("pointerleave", () => {
    histogramDrag = null;
  });
}

function getHistogramPlot() {
  return plots.get(histogramThreshold) || plots.values().next().value;
}

function histogramRange(plot) {
  const minVal = plot.minValue.value;
  const maxVal = plot.maxValue.value;
  const span = Math.max(1, maxVal - minVal);
  return { minVal, maxVal, span };
}

function applyHistogramValue(plot, handle, value) {
  if (!autoscaleToggle.checked) {
    // keep manual values
  } else {
    autoscaleToggle.checked = false;
    updateContrastControls();
  }
  const rounded = Math.round(value);
  if (handle === "min") {
    manualMin = Math.min(rounded, manualMax - 1);
  } else {
    manualMax = Math.max(rounded, manualMin + 1);
  }
  if (contrastMin) contrastMin.value = `${manualMin}`;
  if (contrastMax) contrastMax.value = `${manualMax}`;
  if (contrastMinValue) contrastMinValue.textContent = `${manualMin}`;
  if (contrastMaxValue) contrastMaxValue.textContent = `${manualMax}`;
  plots.forEach((p) => redrawPlot(p));
  scheduleHistogramUpdate();
}

function renderHistogram() {
  if (!histogramCanvas || !histogramCtx) {
    return;
  }
  const plot = getHistogramPlot();
  if (!plot) {
    histogramCtx.clearRect(0, 0, histogramCanvas.width, histogramCanvas.height);
    return;
  }
  const bins = 64;
  const minVal = plot.minValue.value;
  const maxVal = plot.maxValue.value;
  const denom = Math.max(1, maxVal - minVal);
  const counts = new Array(bins).fill(0);
  for (let i = 0; i < plot.values.length; i++) {
    const value = plot.values[i];
    const t = (value - minVal) / denom;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(t * (bins - 1))));
    counts[idx] += 1;
  }
  const maxCount = Math.max(...counts, 1);
  const useLog = histogramLogToggle?.checked;
  const scaleCount = useLog
    ? (value) => Math.log10(1 + value)
    : (value) => value;
  const scaledMax = Math.max(scaleCount(maxCount), 1);

  const dpr = window.devicePixelRatio || 1;
  const width = histogramCanvas.clientWidth || histogramCanvas.width;
  const plotHeight = histogramCanvas.clientHeight || histogramCanvas.height;
  const axisPad = 16;
  const height = plotHeight;
  const totalHeight = plotHeight + axisPad;
  histogramCanvas.width = Math.floor(width * dpr);
  histogramCanvas.height = Math.floor(totalHeight * dpr);
  histogramCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  histogramCtx.clearRect(0, 0, width, totalHeight);
  histogramCtx.fillStyle = "#101010";
  histogramCtx.fillRect(0, 0, width, height);

  const barWidth = width / bins;
  for (let i = 0; i < bins; i++) {
    const h = (scaleCount(counts[i]) / scaledMax) * (height - 6);
    const t = i / (bins - 1);
    const [r, g, b] = colorFromScheme(t, currentScheme);
    histogramCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    histogramCtx.fillRect(i * barWidth, height - h, Math.max(1, barWidth - 1), h);
  }

  const rangeMin = plot.minValue.value;
  const rangeMax = plot.maxValue.value;
  const rangeSpan = Math.max(1, rangeMax - rangeMin);
  const leftVal = autoscaleToggle.checked ? rangeMin : manualMin;
  const rightVal = autoscaleToggle.checked ? rangeMax : manualMax;
  const leftT = (leftVal - rangeMin) / rangeSpan;
  const rightT = (rightVal - rangeMin) / rangeSpan;
  const leftX = Math.min(width, Math.max(0, leftT * width));
  const rightX = Math.min(width, Math.max(0, rightT * width));

  histogramCtx.fillStyle = "rgba(30,30,30,0.9)";
  histogramCtx.font = "10px \"Helvetica Neue\", Helvetica, Arial, sans-serif";
  histogramCtx.textBaseline = "top";
  histogramCtx.textAlign = "center";
  const labelY = height + 4;
  const ticks = 5;
  histogramCtx.strokeStyle = "rgba(245,245,245,0.7)";
  histogramCtx.lineWidth = 1;
  histogramCtx.beginPath();
  for (let i = 0; i <= ticks; i++) {
    const t = i / ticks;
    const x = t * width;
    histogramCtx.moveTo(x, height - 2);
    histogramCtx.lineTo(x, height + 2);
    const value = rangeMin + t * (rangeMax - rangeMin);
    histogramCtx.fillText(value.toFixed(1), x, labelY);
  }
  histogramCtx.stroke();

  histogramCtx.strokeStyle = "rgba(245,245,245,0.9)";
  histogramCtx.lineWidth = 2;
  histogramCtx.beginPath();
  histogramCtx.moveTo(leftX, 0);
  histogramCtx.lineTo(leftX, height);
  histogramCtx.moveTo(rightX, 0);
  histogramCtx.lineTo(rightX, height);
  histogramCtx.stroke();

  histogramCtx.fillStyle = "rgba(245,245,245,0.9)";
  histogramCtx.beginPath();
  histogramCtx.moveTo(leftX - 5, 0);
  histogramCtx.lineTo(leftX + 5, 0);
  histogramCtx.lineTo(leftX, 8);
  histogramCtx.closePath();
  histogramCtx.fill();
  histogramCtx.beginPath();
  histogramCtx.moveTo(rightX - 5, 0);
  histogramCtx.lineTo(rightX + 5, 0);
  histogramCtx.lineTo(rightX, 8);
  histogramCtx.closePath();
  histogramCtx.fill();
}

function exportSnapshot() {
  const plotList = Array.from(plots.values());
  if (!plotList.length) {
    return;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const padding = 16;
  const blockGap = 16;
  const titleHeight = 20;

  const histogramWidth = histogramCanvas?.clientWidth || 240;
  const histogramHeight = histogramCanvas?.clientHeight || 80;
  const histBlockHeight = histogramCanvas ? histogramHeight + 30 : 0;

  const blocks = plotList.map((plot) => {
    const mapWidth = plot.canvas.clientWidth || gridX;
    const mapHeight = plot.canvas.clientHeight || gridY;
    const yWidth = plot.yProjection?.clientWidth || 60;
    const xHeight = plot.xProjection?.clientHeight || 60;
    const width = mapWidth + yWidth + 8 + padding * 2;
    const height = mapHeight + xHeight + 8 + titleHeight + padding * 2;
    return { plot, mapWidth, mapHeight, yWidth, xHeight, width, height };
  });

  const blocksRowWidth = blocks.reduce((sum, block) => sum + block.width, 0) + blockGap * Math.max(0, blocks.length - 1);
  const maxBlockHeight = blocks.reduce((max, block) => Math.max(max, block.height), 0);
  const snapshotWidth = Math.max(blocksRowWidth + padding * 2, histogramWidth + padding * 2);
  const snapshotHeight = padding + histBlockHeight + maxBlockHeight + padding;

  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(snapshotWidth * dpr);
  canvas.height = Math.floor(snapshotHeight * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, snapshotWidth, snapshotHeight);
  ctx.fillStyle = "#111";
  ctx.font = "14px sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(`STXM Snapshot ${timestamp}`, padding, padding);

  let cursorY = padding + 24;
  if (histogramCanvas) {
    ctx.fillStyle = "#222";
    ctx.font = "12px sans-serif";
    ctx.fillText("Histogram", padding, cursorY);
    ctx.drawImage(
      histogramCanvas,
      padding,
      cursorY + 14,
      histogramWidth,
      histogramHeight
    );
    cursorY += histBlockHeight;
  }

  let cursorX = padding;
  blocks.forEach((block) => {
    const { plot, mapWidth, mapHeight, yWidth, xHeight } = block;
    ctx.fillStyle = "#111";
    ctx.font = "13px sans-serif";
    ctx.fillText(plot.canvas?.closest(".plot")?.querySelector("h2")?.textContent || "plot", cursorX, cursorY);

    const mapX = cursorX;
    const mapY = cursorY + titleHeight;
    ctx.drawImage(plot.canvas, mapX, mapY, mapWidth, mapHeight);
    if (plot.yProjection) {
      ctx.drawImage(plot.yProjection, mapX + mapWidth + 8, mapY, yWidth, mapHeight);
    }
    if (plot.xProjection) {
      ctx.drawImage(plot.xProjection, mapX, mapY + mapHeight + 8, mapWidth, xHeight);
    }
    cursorX += block.width + blockGap;
  });

  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement("a");
    link.download = `stxm_snapshot_${timestamp}.png`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  });

  const settings = {
    timestamp,
    scheme: currentScheme,
    autoscale: autoscaleToggle?.checked ?? true,
    manualMin,
    manualMax,
    zoom: globalZoom,
    syncViews: syncViewsToggle?.checked ?? true,
    histogramLog: histogramLogToggle?.checked ?? false,
    thresholds: plotList.map((plot) => ({
      name: plot.canvas?.closest(".plot")?.querySelector("h2")?.textContent || "plot",
      min: plot.minValue.value,
      max: plot.maxValue.value,
    })),
  };
  const settingsBlob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
  const settingsLink = document.createElement("a");
  settingsLink.download = `stxm_snapshot_${timestamp}.json`;
  settingsLink.href = URL.createObjectURL(settingsBlob);
  settingsLink.click();
  URL.revokeObjectURL(settingsLink.href);
}

function scheduleProjectionUpdate(plot) {
  if (!plot || plot.projectionDirty.value) {
    return;
  }
  plot.projectionDirty.value = true;
  const delay = isMobile() ? 120 : 0;
  if (delay > 0) {
    setTimeout(() => {
      plot.projectionDirty.value = false;
      renderProjections(plot);
    }, delay);
  } else {
    requestAnimationFrame(() => {
      plot.projectionDirty.value = false;
      renderProjections(plot);
    });
  }
}

function renderProjections(plot) {
  if (!plot?.xProjectionCtx || !plot?.yProjectionCtx) {
    return;
  }
  const xCanvas = plot.xProjection;
  const yCanvas = plot.yProjection;
  const xCtx = plot.xProjectionCtx;
  const yCtx = plot.yProjectionCtx;
  const wrap = plot.canvasWrap;
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = wrap?.clientWidth || 240;
  const targetHeight = wrap?.clientHeight || 240;
  const xWidth = targetWidth;
  const xHeight = xCanvas.clientHeight || 60;
  const yWidth = yCanvas.clientWidth || 60;
  const yHeight = targetHeight;

  xCanvas.style.width = `${xWidth}px`;
  yCanvas.style.height = `${yHeight}px`;

  xCanvas.width = Math.floor(xWidth * dpr);
  xCanvas.height = Math.floor(xHeight * dpr);
  xCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  xCtx.clearRect(0, 0, xWidth, xHeight);
  xCtx.clearRect(0, 0, xWidth, xHeight);

  yCanvas.width = Math.floor(yWidth * dpr);
  yCanvas.height = Math.floor(yHeight * dpr);
  yCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  yCtx.clearRect(0, 0, yWidth, yHeight);
  yCtx.clearRect(0, 0, yWidth, yHeight);

  const visible = getVisibleRange(plot);
  let maxX = 0;
  let minX = Number.POSITIVE_INFINITY;
  for (let i = visible.xStart; i <= visible.xEnd; i++) {
    const mean = plot.xSums[i] / Math.max(1, visible.yCount);
    if (mean > maxX) maxX = mean;
    if (mean < minX) minX = mean;
  }
  if (!Number.isFinite(minX)) minX = 0;
  let maxY = 0;
  let minY = Number.POSITIVE_INFINITY;
  for (let i = visible.yStart; i <= visible.yEnd; i++) {
    const mean = plot.ySums[i] / Math.max(1, visible.xCount);
    if (mean > maxY) maxY = mean;
    if (mean < minY) minY = mean;
  }
  if (!Number.isFinite(minY)) minY = 0;
  maxX = Math.max(minX + 1e-6, maxX);
  maxY = Math.max(minY + 1e-6, maxY);
  const scaleCount = (value, minValue, maxValue) => {
    const clamped = Math.min(maxValue, Math.max(minValue, value));
    return Math.log10(1 + (clamped - minValue));
  };
  const scaledMaxX = Math.max(1e-6, scaleCount(maxX, minX, maxX));
  const scaledMaxY = Math.max(1e-6, scaleCount(maxY, minY, maxY));

  const xPad = 4;
  const xPlotWidth = Math.max(1, xWidth - xPad * 2);
  xCtx.beginPath();
  for (let x = 0; x < gridX; x++) {
    if (x < visible.xStart || x > visible.xEnd) continue;
    const value = plot.xSums[x] / Math.max(1, visible.yCount);
    const h = (scaleCount(value, minX, maxX) / scaledMaxX) * (xHeight - 8);
    const px = xPad + ((x - visible.xStart) / Math.max(1, visible.xCount - 1)) * xPlotWidth;
    const py = xHeight - 4 - h;
    if (x === visible.xStart) {
      xCtx.moveTo(px, py);
    } else {
      xCtx.lineTo(px, py);
    }
  }
  xCtx.lineTo(xPad + xPlotWidth, xHeight - 4);
  xCtx.lineTo(xPad, xHeight - 4);
  xCtx.closePath();
  xCtx.fillStyle = hexToRgba(accentColor, 0.15);
  xCtx.fill();
  xCtx.beginPath();
  for (let x = 0; x < gridX; x++) {
    if (x < visible.xStart || x > visible.xEnd) continue;
    const value = plot.xSums[x] / Math.max(1, visible.yCount);
    const h = (scaleCount(value, minX, maxX) / scaledMaxX) * (xHeight - 8);
    const px = xPad + ((x - visible.xStart) / Math.max(1, visible.xCount - 1)) * xPlotWidth;
    const py = xHeight - 4 - h;
    if (x === visible.xStart) {
      xCtx.moveTo(px, py);
    } else {
      xCtx.lineTo(px, py);
    }
  }
  xCtx.strokeStyle = hexToRgba(accentColor, 0.9);
  xCtx.lineWidth = 1.6;
  xCtx.stroke();

  const yPad = 4;
  const yPlotHeight = Math.max(1, yHeight - yPad * 2);
  yCtx.beginPath();
  for (let y = 0; y < gridY; y++) {
    if (y < visible.yStart || y > visible.yEnd) continue;
    const value = plot.ySums[y] / Math.max(1, visible.xCount);
    const w = (scaleCount(value, minY, maxY) / scaledMaxY) * (yWidth - 8);
    const px = yPad + w;
    const py = yPad + ((y - visible.yStart) / Math.max(1, visible.yCount - 1)) * yPlotHeight;
    if (y === visible.yStart) {
      yCtx.moveTo(px, py);
    } else {
      yCtx.lineTo(px, py);
    }
  }
  yCtx.lineTo(yPad, yPad + yPlotHeight);
  yCtx.lineTo(yPad, yPad);
  yCtx.closePath();
  yCtx.fillStyle = hexToRgba(accentColor, 0.15);
  yCtx.fill();
  yCtx.beginPath();
  for (let y = 0; y < gridY; y++) {
    if (y < visible.yStart || y > visible.yEnd) continue;
    const value = plot.ySums[y] / Math.max(1, visible.xCount);
    const w = (scaleCount(value, minY, maxY) / scaledMaxY) * (yWidth - 8);
    const px = yPad + w;
    const py = yPad + ((y - visible.yStart) / Math.max(1, visible.yCount - 1)) * yPlotHeight;
    if (y === visible.yStart) {
      yCtx.moveTo(px, py);
    } else {
      yCtx.lineTo(px, py);
    }
  }
  yCtx.strokeStyle = hexToRgba(accentColor, 0.9);
  yCtx.lineWidth = 1.6;
  yCtx.stroke();

  drawProjectionScaleX(xCtx, xWidth, xHeight, minX, maxX);
  drawProjectionScaleY(yCtx, yWidth, yHeight, minY, maxY);
}

function getVisibleRange(plot) {
  const pixelSize = plot.basePixel.value * (syncViewsToggle?.checked ? globalZoom : plot.zoom.value);
  const startX = Math.max(0, Math.floor(plot.canvasWrap.scrollLeft / pixelSize));
  const startY = Math.max(0, Math.floor(plot.canvasWrap.scrollTop / pixelSize));
  const countX = Math.max(1, Math.ceil(plot.canvasWrap.clientWidth / pixelSize));
  const countY = Math.max(1, Math.ceil(plot.canvasWrap.clientHeight / pixelSize));
  const endX = Math.min(gridX - 1, startX + countX - 1);
  const endY = Math.min(gridY - 1, startY + countY - 1);
  return {
    xStart: startX,
    xEnd: endX,
    yStart: startY,
    yEnd: endY,
    xCount: endX - startX + 1,
    yCount: endY - startY + 1,
  };
}

function drawProjectionScaleX(ctx, width, height, minValue, maxValue) {
  ctx.save();
  ctx.strokeStyle = "rgba(60,60,60,0.6)";
  ctx.fillStyle = "rgba(60,60,60,0.8)";
  ctx.lineWidth = 1;
  const left = 4;
  const right = width - 4;
  const bottom = height - 4;
  const top = 4;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left + 6, top);
  ctx.moveTo(left, bottom);
  ctx.lineTo(left + 6, bottom);
  ctx.stroke();
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${minValue.toFixed(1)}`, left + 8, bottom);
  ctx.textBaseline = "top";
  ctx.fillText(`${maxValue.toFixed(1)}`, left + 8, top);
  ctx.textBaseline = "top";
  ctx.textAlign = "right";
  ctx.fillText("log", right, top);
  ctx.restore();
}

function drawProjectionScaleY(ctx, width, height, minValue, maxValue) {
  ctx.save();
  ctx.strokeStyle = "rgba(60,60,60,0.6)";
  ctx.fillStyle = "rgba(60,60,60,0.8)";
  ctx.lineWidth = 1;
  const left = 4;
  const right = width - 4;
  const bottom = height - 4;
  const top = 4;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(left, bottom - 6);
  ctx.moveTo(right, bottom);
  ctx.lineTo(right, bottom - 6);
  ctx.stroke();
  const minVal = Math.min(minValue, maxValue);
  const maxVal = Math.max(minValue, maxValue);
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${minVal.toFixed(1)}`, left, bottom - 8);
  ctx.textAlign = "right";
  ctx.fillText(`${maxVal.toFixed(1)}`, right, bottom - 8);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("log", left, top);
  ctx.restore();
}

function startStatusPolling() {
  setInterval(async () => {
    try {
      const res = await fetch("/status");
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      setStatus(detectorStatusEl, data.detector);
      setStatus(streamStatusEl, data.stream);
      setStatus(filewriterStatusEl, data.filewriter);
      setStatus(monitorStatusEl, data.monitor);

      const metrics = data.metrics || {};
      const recvTotal = metrics.image_messages_total ?? metrics.raw_messages_total;
      if (typeof recvTotal === "number") {
        const now = performance.now();
        if (lastRecvCount != null && lastRecvTime > 0) {
          const delta = recvTotal - lastRecvCount;
          const elapsed = (now - lastRecvTime) / 1000;
          if (elapsed > 0 && recvRateEl) {
            const rate = Math.max(0, Math.round(delta / elapsed));
            recvRateEl.textContent = `RX ${rate} Hz`;
          }
        } else if (recvRateEl) {
          recvRateEl.textContent = "RX 0 Hz";
        }
        lastRecvCount = recvTotal;
        lastRecvTime = now;
      }

      if (staleBanner) {
        const lastIngest = Date.parse(data.last_ingest || "");
        const ageMs = Number.isFinite(lastIngest) ? Date.now() - lastIngest : Number.POSITIVE_INFINITY;
        const isStale = ageMs > 5000;
        staleBanner.classList.toggle("hidden", !isStale);
      }
    } catch (err) {
      setStatus(streamStatusEl, "error");
    }
  }, 1000);
}

function hexToRgba(color, alpha) {
  const hex = color.replace("#", "");
  if (hex.length !== 6) {
    return `rgba(15,118,110,${alpha})`;
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function setStatus(el, value) {
  if (!el) return;
  const textEl = el.querySelector(".status-text");
  if (textEl) {
    textEl.textContent = value || "unknown";
  }
  el.classList.remove("status-ok", "status-warn", "status-error", "status-info", "status-idle");
  const cls = statusClass(value);
  if (cls) {
    el.classList.add(cls);
  }
}

function statusClass(value) {
  if (!value) {
    return "status-warn";
  }
  if (typeof value === "string" && value.startsWith("http_")) {
    return "status-error";
  }
  switch (value) {
    case "ok":
    case "connected":
    case "receiving":
    case "ready":
    case "running":
    case "active":
    case "acquiring":
    case "streaming":
      return "status-ok";
    case "idle":
    case "standby":
    case "na":
      return "status-idle";
    case "writing":
    case "simulator":
      return "status-info";
    case "error":
    case "fault":
    case "offline":
      return "status-error";
    case "warning":
    case "warn":
      return "status-warn";
    default:
      return "status-warn";
  }
}

function colorFromScheme(t, scheme) {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  let x = clamp(t);
  if (scheme === "gray") {
    const v = Math.floor(255 * x);
    return [v, v, v];
  }
  if (scheme === "heat") {
    const r = Math.floor(255 * x);
    const g = Math.floor(200 * Math.pow(x, 0.7));
    const b = Math.floor(80 * Math.pow(x, 2));
    return [r, g, b];
  }
  if (scheme === "viridis") {
    const r = Math.floor(255 * (0.1 + 0.9 * x));
    const g = Math.floor(255 * (0.2 + 0.8 * Math.sin(x * Math.PI)));
    const b = Math.floor(255 * (0.9 - 0.9 * x));
    return [r, g, b];
  }
  if (scheme === "albula-hdr") {
    x = Math.log10(1 + 9 * x); // boost low intensities
    const r = Math.floor(255 * (0.12 + 0.88 * x));
    const g = Math.floor(255 * (0.08 + 0.82 * Math.pow(x, 0.8)));
    const b = Math.floor(255 * (0.3 + 0.7 * (1 - Math.pow(x, 0.6))));
    return [r, g, b];
  }
  const r = Math.floor(255 * x);
  const g = Math.floor(180 * x);
  const b = Math.floor(255 * (1 - x));
  return [r, g, b];
}

function gradientFromScheme(scheme, vertical = false) {
  const angle = vertical ? "180deg" : "90deg";
  if (scheme === "gray") {
    return `linear-gradient(${angle}, #000, #fff)`;
  }
  if (scheme === "heat") {
    return `linear-gradient(${angle}, #220000, #ffb400, #ff0000)`;
  }
  if (scheme === "viridis") {
    return `linear-gradient(${angle}, #440154, #31688e, #35b779, #fde725)`;
  }
  if (scheme === "albula-hdr") {
    return `linear-gradient(${angle}, #001a33, #0b3c6f, #3f8fd2, #ffd54a, #ff5a3d)`;
  }
  return `linear-gradient(${angle}, #0000ff, #ffb400, #ff0000)`;
}

syncViewsToggle?.addEventListener("change", () => {
  if (syncViewsToggle.checked) {
    setGlobalZoom(globalZoom);
    const first = plots.values().next().value;
    if (first) {
      plots.forEach((plot) => {
        plot.canvasWrap.scrollLeft = first.canvasWrap.scrollLeft;
        plot.canvasWrap.scrollTop = first.canvasWrap.scrollTop;
      });
    }
    if (zoomInBtn) zoomInBtn.disabled = false;
    if (zoomOutBtn) zoomOutBtn.disabled = false;
    if (zoomResetBtn) zoomResetBtn.disabled = false;
    if (zoomSlider) {
      zoomSlider.disabled = false;
    }
  } else {
    plots.forEach((plot) => {
      plot.zoom.value = globalZoom;
      updatePlotScale(plot);
    });
    if (zoomInBtn) zoomInBtn.disabled = true;
    if (zoomOutBtn) zoomOutBtn.disabled = true;
    if (zoomResetBtn) zoomResetBtn.disabled = true;
    if (zoomSlider) {
      zoomSlider.disabled = true;
    }
  }
});

function updatePixelLabels(plot) {
  const pixelSize = plot.basePixel.value * (syncViewsToggle?.checked ? globalZoom : plot.zoom.value);
  if (pixelSize < labelMinPixels) {
    plot.pixelLabels.style.display = "none";
    return;
  }
  plot.pixelLabels.style.display = "grid";
  plot.pixelLabels.style.gridTemplateColumns = `repeat(${gridX}, ${pixelSize}px)`;
  plot.pixelLabels.style.gridAutoRows = `${pixelSize}px`;
  plot.pixelLabels.innerHTML = "";
  for (let i = 0; i < plot.values.length; i++) {
    const cell = document.createElement("div");
    cell.className = "pixel-label";
    cell.textContent = plot.values[i];
    plot.pixelLabels.appendChild(cell);
  }
}

function computeMinZoom(plot) {
  const wrapWidth = plot.canvasWrap.clientWidth || 1;
  const wrapHeight = plot.canvasWrap.clientHeight || 1;
  const basePixel = Math.max(1, plot.basePixel.value);
  const minZoomX = wrapWidth / (gridX * basePixel);
  const minZoomY = wrapHeight / (gridY * basePixel);
  return Math.max(0.5, Math.max(minZoomX, minZoomY));
}

function getMinZoomForPlots() {
  let minAllowed = 0.5;
  plots.forEach((plot) => {
    const candidate = computeMinZoom(plot);
    if (candidate > minAllowed) {
      minAllowed = candidate;
    }
  });
  return minAllowed;
}

function updateZoomBounds() {
  minZoom = getMinZoomForPlots();
  if (zoomSlider) {
    zoomSlider.min = minZoom.toFixed(2);
  }
  if (zoomLevelEl) {
    const current = syncViewsToggle?.checked ? globalZoom : globalZoom;
    zoomLevelEl.textContent = `${Math.max(minZoom, current).toFixed(1)}x`;
  }
}

function updateFooterPadding() {
  if (!footerEl) return;
  const height = Math.ceil(footerEl.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--footer-height", `${height}px`);
}

function updateHeaderPadding() {
  if (!headerEl) return;
  const height = Math.ceil(headerEl.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--header-height", `${height}px`);
}

function scheduleLayoutRefresh() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      plots.forEach((plot) => updatePlotScale(plot));
      updateFooterPadding();
      updateHeaderPadding();
    });
  });
  setTimeout(() => {
    plots.forEach((plot) => updatePlotScale(plot));
    updateFooterPadding();
    updateHeaderPadding();
  }, 50);
}

function setupLayoutObserver() {
  if (!plotsContainer || !window.ResizeObserver) {
    return;
  }
  const observer = new ResizeObserver(() => {
    plots.forEach((plot) => updatePlotScale(plot));
    updateFooterPadding();
    updateHeaderPadding();
  });
  observer.observe(plotsContainer);
  if (footerEl) {
    observer.observe(footerEl);
  }
  if (headerEl) {
    observer.observe(headerEl);
  }
}
