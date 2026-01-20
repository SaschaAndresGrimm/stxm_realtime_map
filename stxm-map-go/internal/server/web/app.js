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

updateContrastControls();

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

  controls.appendChild(title);
  controls.appendChild(exportBtn);
  container.appendChild(controls);
  canvasInner.appendChild(canvas);
  canvasInner.appendChild(gridOverlay);
  canvasInner.appendChild(pixelLabels);
  canvasWrap.appendChild(canvasInner);
  canvasWrap.appendChild(tooltip);
  container.appendChild(canvasWrap);

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

  plot.values[imageId] = value;
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
}

const ws = new WebSocket(`ws://${location.host}/ws`);
ws.addEventListener("open", () => {
  statusEl.textContent = "Connected";
});
ws.addEventListener("close", () => {
  statusEl.textContent = "Disconnected";
});
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "config") {
    gridX = msg.grid_x;
    gridY = msg.grid_y;
    plotsEl.innerHTML = "";
    (msg.thresholds || []).forEach(createPlot);
    plots.forEach((plot) => {
      const rect = plot.canvasWrap.getBoundingClientRect();
      plot.basePixel.value = Math.max(6, Math.floor(rect.width / gridX));
      updatePlotScale(plot);
    });
    return;
  }

  if (!gridX || !gridY) return;
  const imageId = msg.image_id;
  Object.entries(msg.data || {}).forEach(([threshold, value]) => {
    updatePixel(threshold, imageId, value);
  });

  plots.forEach((plot) => updatePixelLabels(plot));

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
});

autoscaleToggle?.addEventListener("change", () => {
  plots.forEach((plot) => redrawPlot(plot));
  updateContrastControls();
});

let resizing = false;
let startX = 0;
let startWidth = 0;

panelHandle?.addEventListener("click", () => {
  controlPanel?.classList.toggle("panel-open");
});

panelHandle?.addEventListener("mousedown", (event) => {
  event.preventDefault();
  resizing = true;
  startX = event.clientX;
  startWidth = controlPanel ? controlPanel.getBoundingClientRect().width : 260;
  controlPanel?.classList.add("panel-open");
});

window.addEventListener("mousemove", (event) => {
  if (!resizing || !controlPanel) return;
  const delta = startX - event.clientX;
  const nextWidth = Math.min(420, Math.max(200, startWidth + delta));
  controlPanel.style.width = `${nextWidth}px`;
});

window.addEventListener("mouseup", () => {
  resizing = false;
});

contrastMin?.addEventListener("input", () => {
  manualMin = Math.min(parseInt(contrastMin.value, 10), manualMax - 1);
  contrastMin.value = `${manualMin}`;
  if (contrastMinValue) contrastMinValue.textContent = `${manualMin}`;
  plots.forEach((plot) => redrawPlot(plot));
});

contrastMax?.addEventListener("input", () => {
  manualMax = Math.max(parseInt(contrastMax.value, 10), manualMin + 1);
  contrastMax.value = `${manualMax}`;
  if (contrastMaxValue) contrastMaxValue.textContent = `${manualMax}`;
  plots.forEach((plot) => redrawPlot(plot));
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
}

function updateContrastControls() {
  const disabled = autoscaleToggle?.checked;
  if (contrastMin) contrastMin.disabled = disabled;
  if (contrastMax) contrastMax.disabled = disabled;
  if (contrastMinValue) contrastMinValue.textContent = `${manualMin}`;
  if (contrastMaxValue) contrastMaxValue.textContent = `${manualMax}`;
}

function colorFromScheme(t, scheme) {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const x = clamp(t);
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
