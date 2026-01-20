const statusEl = document.getElementById("status");
const plotsEl = document.getElementById("plots");
const fpsEl = document.getElementById("fps");
const autoscaleToggle = document.getElementById("autoscale");
const zoomLevelEl = document.getElementById("zoom-level");
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const zoomResetBtn = document.getElementById("zoom-reset");
const zoomSlider = document.getElementById("zoom-slider");
const syncViewsToggle = document.getElementById("sync-views");
const controlPanel = document.getElementById("control-panel");
const panelHandle = document.getElementById("panel-handle");
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

let gridX = 0;
let gridY = 0;
const plots = new Map();
let lastFrameTime = performance.now();
let frameCount = 0;
let globalZoom = 1;
const labelMinPixels = 20;
let currentScheme = "blue-yellow-red";
let manualMin = 0;
let manualMax = 255;
let histogramThreshold = "";
let histogramDirty = false;

updateContrastControls();
updatePanelPadding();
startStatusPolling();

function createPlot(threshold) {
  const container = document.createElement("div");
  container.className = "plot";
  const controls = document.createElement("div");
  controls.className = "plot-controls";
  const title = document.createElement("h2");
  title.textContent = threshold;
  const exportBtn = document.createElement("button");
  exportBtn.className = "export-btn";
  exportBtn.textContent = "Export PNG";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "canvas-wrap";
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
  plotBody.appendChild(canvasWrap);
  plotBody.appendChild(yProjection);
  container.appendChild(plotBody);
  projectionRow.appendChild(xProjection);
  projectionRow.appendChild(projectionSpacer);
  container.appendChild(projectionRow);

  const colorbar = document.createElement("div");
  colorbar.className = "colorbar";
  colorbar.style.background = gradientFromScheme(currentScheme);
  const labels = document.createElement("div");
  labels.className = "colorbar-labels";
  const minLabel = document.createElement("span");
  minLabel.textContent = "0";
  const maxLabel = document.createElement("span");
  maxLabel.textContent = "0";
  labels.appendChild(minLabel);
  labels.appendChild(maxLabel);
  container.appendChild(colorbar);
  container.appendChild(labels);
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

const ws = new WebSocket(`ws://${location.host}/ws`);
ws.addEventListener("open", () => {
  statusEl.textContent = "Connected";
});
ws.addEventListener("close", () => {
  statusEl.textContent = "Disconnected";
  setStatus(detectorStatusEl, "na");
  setStatus(streamStatusEl, "na");
  setStatus(filewriterStatusEl, "na");
  setStatus(monitorStatusEl, "na");
});
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "config") {
    gridX = msg.grid_x;
    gridY = msg.grid_y;
    plotsEl.innerHTML = "";
    (msg.thresholds || []).forEach(createPlot);
    histogramThreshold = (msg.thresholds || [])[0] || "";
    plots.forEach((plot) => {
      const rect = plot.canvasWrap.getBoundingClientRect();
      plot.basePixel.value = Math.max(6, Math.floor(rect.width / gridX));
      updatePlotScale(plot);
    });
    scheduleHistogramUpdate();
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
    fpsEl.textContent = `${fps} fps`;
    frameCount = 0;
    lastFrameTime = now;
  }
});

function updatePlotScale(plot) {
  const pixelSize = plot.basePixel.value * (syncViewsToggle?.checked ? globalZoom : plot.zoom.value);
  const widthPx = gridX * pixelSize;
  const heightPx = gridY * pixelSize;
  plot.canvas.width = gridX;
  plot.canvas.height = gridY;
  plot.canvas.style.width = `${widthPx}px`;
  plot.canvas.style.height = `${heightPx}px`;
  plot.canvasInner.style.width = `${widthPx}px`;
  plot.canvasInner.style.height = `${heightPx}px`;
  plot.gridOverlay.style.backgroundSize = `${pixelSize}px ${pixelSize}px`;
  updatePixelLabels(plot);
  scheduleProjectionUpdate(plot);
}

function setGlobalZoom(value) {
  globalZoom = value;
  plots.forEach((plot) => updatePlotScale(plot));
  if (zoomLevelEl) {
    zoomLevelEl.textContent = `${globalZoom.toFixed(1)}x`;
  }
  if (zoomSlider) {
    zoomSlider.value = globalZoom.toFixed(1);
  }
}

function setPlotZoom(plot, value) {
  plot.zoom.value = value;
  updatePlotScale(plot);
}

zoomInBtn?.addEventListener("click", () => {
  setGlobalZoom(Math.min(8, Math.max(0.5, globalZoom * 1.25)));
});

zoomOutBtn?.addEventListener("click", () => {
  setGlobalZoom(Math.min(8, Math.max(0.5, globalZoom * 0.8)));
});

zoomResetBtn?.addEventListener("click", () => {
  setGlobalZoom(1);
});

zoomSlider?.addEventListener("input", (event) => {
  const value = parseFloat(event.target.value);
  if (Number.isFinite(value)) {
    setGlobalZoom(Math.min(8, Math.max(0.5, value)));
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "+" || event.key === "=") {
    setGlobalZoom(Math.min(8, Math.max(0.5, globalZoom * 1.25)));
  } else if (event.key === "-" || event.key === "_") {
    setGlobalZoom(Math.min(8, Math.max(0.5, globalZoom * 0.8)));
  } else if (event.key === "0") {
    setGlobalZoom(1);
  }
});

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

panelHandle?.addEventListener("click", () => {
  controlPanel?.classList.toggle("panel-open");
  updatePanelPadding();
});

panelHandle?.addEventListener("mousedown", (event) => {
  event.preventDefault();
  resizing = true;
  startX = event.clientX;
  startWidth = controlPanel ? controlPanel.getBoundingClientRect().width : 260;
  controlPanel?.classList.add("panel-open");
  updatePanelPadding();
});

window.addEventListener("mousemove", (event) => {
  if (!resizing || !controlPanel) return;
  const delta = startX - event.clientX;
  const nextWidth = Math.min(420, Math.max(200, startWidth + delta));
  controlPanel.style.width = `${nextWidth}px`;
  document.body.style.setProperty("--panel-width", `${nextWidth}px`);
  scheduleHistogramUpdate();
  plots.forEach((plot) => scheduleProjectionUpdate(plot));
});

window.addEventListener("mouseup", () => {
  resizing = false;
});

window.addEventListener("resize", () => {
  scheduleHistogramUpdate();
  plots.forEach((plot) => scheduleProjectionUpdate(plot));
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
    plot.colorbar.style.background = gradientFromScheme(currentScheme);
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
  requestAnimationFrame(() => {
    histogramDirty = false;
    renderHistogram();
  });
}

function renderHistogram() {
  if (!histogramCanvas || !histogramCtx) {
    return;
  }
  const plot = plots.get(histogramThreshold) || plots.values().next().value;
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
  const height = histogramCanvas.clientHeight || histogramCanvas.height;
  histogramCanvas.width = Math.floor(width * dpr);
  histogramCanvas.height = Math.floor(height * dpr);
  histogramCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  histogramCtx.clearRect(0, 0, width, height);

  const barWidth = width / bins;
  for (let i = 0; i < bins; i++) {
    const h = (scaleCount(counts[i]) / scaledMax) * (height - 6);
    const t = i / (bins - 1);
    const [r, g, b] = colorFromScheme(t, currentScheme);
    histogramCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    histogramCtx.fillRect(i * barWidth, height - h, Math.max(1, barWidth - 1), h);
  }
}

function scheduleProjectionUpdate(plot) {
  if (!plot || plot.projectionDirty.value) {
    return;
  }
  plot.projectionDirty.value = true;
  requestAnimationFrame(() => {
    plot.projectionDirty.value = false;
    renderProjections(plot);
  });
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

  let maxX = 0;
  let minX = Number.POSITIVE_INFINITY;
  for (let i = 0; i < plot.xSums.length; i++) {
    const mean = plot.xSums[i] / Math.max(1, gridY);
    if (mean > maxX) maxX = mean;
    if (mean < minX) minX = mean;
  }
  if (!Number.isFinite(minX)) minX = 0;
  let maxY = 0;
  let minY = Number.POSITIVE_INFINITY;
  for (let i = 0; i < plot.ySums.length; i++) {
    const mean = plot.ySums[i] / Math.max(1, plot.rowCounts[i]);
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
    const value = plot.xSums[x] / Math.max(1, gridY);
    const h = (scaleCount(value, minX, maxX) / scaledMaxX) * (xHeight - 8);
    const px = xPad + (x / Math.max(1, gridX - 1)) * xPlotWidth;
    const py = xHeight - 4 - h;
    if (x === 0) {
      xCtx.moveTo(px, py);
    } else {
      xCtx.lineTo(px, py);
    }
  }
  xCtx.lineTo(xPad + xPlotWidth, xHeight - 4);
  xCtx.lineTo(xPad, xHeight - 4);
  xCtx.closePath();
  xCtx.fillStyle = "rgba(30,30,30,0.08)";
  xCtx.fill();
  xCtx.beginPath();
  for (let x = 0; x < gridX; x++) {
    const value = plot.xSums[x] / Math.max(1, gridY);
    const h = (scaleCount(value, minX, maxX) / scaledMaxX) * (xHeight - 8);
    const px = xPad + (x / Math.max(1, gridX - 1)) * xPlotWidth;
    const py = xHeight - 4 - h;
    if (x === 0) {
      xCtx.moveTo(px, py);
    } else {
      xCtx.lineTo(px, py);
    }
  }
  xCtx.strokeStyle = "rgba(30,30,30,0.85)";
  xCtx.lineWidth = 1.6;
  xCtx.stroke();

  const yPad = 4;
  const yPlotHeight = Math.max(1, yHeight - yPad * 2);
  yCtx.beginPath();
  for (let y = 0; y < gridY; y++) {
    const value = plot.ySums[y] / Math.max(1, plot.rowCounts[y]);
    const w = (scaleCount(value, minY, maxY) / scaledMaxY) * (yWidth - 8);
    const px = yPad + w;
    const py = yPad + (y / Math.max(1, gridY - 1)) * yPlotHeight;
    if (y === 0) {
      yCtx.moveTo(px, py);
    } else {
      yCtx.lineTo(px, py);
    }
  }
  yCtx.lineTo(yPad, yPad + yPlotHeight);
  yCtx.lineTo(yPad, yPad);
  yCtx.closePath();
  yCtx.fillStyle = "rgba(30,30,30,0.08)";
  yCtx.fill();
  yCtx.beginPath();
  for (let y = 0; y < gridY; y++) {
    const value = plot.ySums[y] / Math.max(1, plot.rowCounts[y]);
    const w = (scaleCount(value, minY, maxY) / scaledMaxY) * (yWidth - 8);
    const px = yPad + w;
    const py = yPad + (y / Math.max(1, gridY - 1)) * yPlotHeight;
    if (y === 0) {
      yCtx.moveTo(px, py);
    } else {
      yCtx.lineTo(px, py);
    }
  }
  yCtx.strokeStyle = "rgba(30,30,30,0.85)";
  yCtx.lineWidth = 1.6;
  yCtx.stroke();

  drawProjectionScaleX(xCtx, xWidth, xHeight, minX, maxX);
  drawProjectionScaleY(yCtx, yWidth, yHeight, minY, maxY);
}

function drawProjectionScaleX(ctx, width, height, minValue, maxValue) {
  ctx.save();
  ctx.strokeStyle = "rgba(30,30,30,0.6)";
  ctx.fillStyle = "rgba(30,30,30,0.8)";
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
  ctx.strokeStyle = "rgba(30,30,30,0.6)";
  ctx.fillStyle = "rgba(30,30,30,0.8)";
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
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${minValue.toFixed(1)}`, left, bottom - 8);
  ctx.textAlign = "right";
  ctx.fillText(`${maxValue.toFixed(1)}`, right, bottom - 8);
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
    } catch (err) {
      setStatus(streamStatusEl, "error");
    }
  }, 1000);
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

function gradientFromScheme(scheme) {
  if (scheme === "gray") {
    return "linear-gradient(90deg, #000, #fff)";
  }
  if (scheme === "heat") {
    return "linear-gradient(90deg, #220000, #ffb400, #ff0000)";
  }
  if (scheme === "viridis") {
    return "linear-gradient(90deg, #440154, #31688e, #35b779, #fde725)";
  }
  if (scheme === "albula-hdr") {
    return "linear-gradient(90deg, #001a33, #0b3c6f, #3f8fd2, #ffd54a, #ff5a3d)";
  }
  return "linear-gradient(90deg, #0000ff, #ffb400, #ff0000)";
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
