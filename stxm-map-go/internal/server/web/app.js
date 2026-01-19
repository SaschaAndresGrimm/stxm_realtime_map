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

  canvas.width = gridX;
  canvas.height = gridY;

  const imageData = ctx.createImageData(gridX, gridY);
  const maxValue = { value: 1 };

  container.appendChild(title);
  container.appendChild(canvas);
  plotsEl.appendChild(container);

  plots.set(threshold, { canvas, ctx, imageData, maxValue });
}

function updatePixel(threshold, imageId, value) {
  const plot = plots.get(threshold);
  if (!plot) return;

  if (value > plot.maxValue.value) {
    plot.maxValue.value = value;
  }
  const x = imageId % gridX;
  const y = Math.floor(imageId / gridX);
  const idx = (y * gridX + x) * 4;
  const intensity = Math.floor((value / plot.maxValue.value) * 255);

  plot.imageData.data[idx] = intensity;
  plot.imageData.data[idx + 1] = intensity;
  plot.imageData.data[idx + 2] = intensity;
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
    return;
  }

  if (!gridX || !gridY) return;
  const imageId = msg.image_id;
  Object.entries(msg.data || {}).forEach(([threshold, value]) => {
    updatePixel(threshold, imageId, value);
  });
});
