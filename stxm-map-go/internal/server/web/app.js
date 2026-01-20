const statusEl = document.getElementById("status");
const plotsEl = document.getElementById("plots");

let gridX = 0;
let gridY = 0;
const plots = new Map();

function createPlot(threshold) {
  const container = document.createElement("div");
  container.className = "plot";
  const title = document.createElement("h2");
  title.textContent = threshold;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const gridOverlay = document.createElement("div");
  gridOverlay.className = "grid-overlay";

  canvas.width = gridX;
  canvas.height = gridY;

  const imageData = ctx.createImageData(gridX, gridY);
  const maxValue = { value: 1 };

  container.appendChild(title);
  container.appendChild(canvas);
  container.appendChild(gridOverlay);

  const colorbar = document.createElement("div");
  colorbar.className = "colorbar";
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

  plots.set(threshold, { canvas, ctx, imageData, maxValue, minLabel, maxLabel });
}

function updatePixel(threshold, imageId, value) {
  const plot = plots.get(threshold);
  if (!plot) return;

  if (value > plot.maxValue.value) {
    plot.maxValue.value = value;
    plot.maxLabel.textContent = `${plot.maxValue.value}`;
  }
  const x = imageId % gridX;
  const y = Math.floor(imageId / gridX);
  const idx = (y * gridX + x) * 4;
  const intensity = Math.min(255, Math.floor((value / plot.maxValue.value) * 255));
  const t = intensity / 255;
  const r = Math.floor(255 * t);
  const g = Math.floor(180 * t);
  const b = Math.floor(255 * (1 - t));

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
    document.querySelectorAll(".grid-overlay").forEach((el) => {
      el.style.setProperty("--grid-size", `${100 / gridX}%`);
    });
    return;
  }

  if (!gridX || !gridY) return;
  const imageId = msg.image_id;
  Object.entries(msg.data || {}).forEach(([threshold, value]) => {
    updatePixel(threshold, imageId, value);
  });
});
