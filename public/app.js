const socket = io();

const map = L.map("map").setView([11.025, 76.96], 14);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

let stopMarkers = {};
let busMarkers = {};
let routeDrawn = false;

const busColors = { "BUS-101": "#4fa3ff", "BUS-102": "#ffb84f", "BUS-103": "#c586ff" };

function drawRoute(stops) {
  if (routeDrawn) return;
  routeDrawn = true;
  const latlngs = stops.map((s) => [s.lat, s.lng]);
  latlngs.push(latlngs[0]); // close the loop
  L.polyline(latlngs, { color: "#3a4256", weight: 3, dashArray: "4 6" }).addTo(map);

  stops.forEach((s) => {
    const m = L.circleMarker([s.lat, s.lng], {
      radius: 7,
      color: "#5b6478",
      fillColor: "#1a1e28",
      fillOpacity: 1,
      weight: 2,
    }).addTo(map);
    m.bindTooltip(`${s.name} (${s.id})`, { direction: "top" });
    stopMarkers[s.id] = m;
  });
}

function busIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #0f1115;box-shadow:0 0 6px ${color};"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function renderState(state) {
  drawRoute(state.stops);

  document.getElementById("speedRange").value = state.simSpeedMultiplier;
  document.getElementById("speedVal").textContent = state.simSpeedMultiplier + "x";

  const busList = document.getElementById("busList");
  busList.innerHTML = "";

  state.buses.forEach((bus) => {
    const color = busColors[bus.busId] || "#4fa3ff";

    if (!busMarkers[bus.busId]) {
      busMarkers[bus.busId] = L.marker([bus.lat, bus.lng], {
        icon: busIcon(color),
      }).addTo(map);
    }
    const marker = busMarkers[bus.busId];
    marker.setLatLng([bus.lat, bus.lng]);
    marker.setOpacity(bus.alive ? 1 : 0.3);

    const etaHtml = bus.eta
      .map((e) => `<div><span>${e.stopName}</span><span>${e.etaSeconds}s</span></div>`)
      .join("");

    const card = document.createElement("div");
    card.className = "bus-card" + (bus.alive ? "" : " dead");
    card.innerHTML = `
      <div class="row">
        <span class="busid">${bus.busId}</span>
        <span class="status ${bus.alive ? "alive" : "dead"}">${bus.alive ? "● LIVE" : "○ OFFLINE"}</span>
      </div>
      <div style="font-size:11px;color:#8290a3;margin-top:2px;">last seen: ${bus.lastSightingStopId}</div>
      <div class="eta-list">${etaHtml}</div>
      <div class="btns">
        <button data-action="kill" data-bus="${bus.busId}" ${!bus.alive ? "disabled" : ""}>Kill node</button>
        <button data-action="revive" data-bus="${bus.busId}" ${bus.alive ? "disabled" : ""}>Revive</button>
      </div>
    `;
    busList.appendChild(card);
  });
}

document.getElementById("busList").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const command = btn.dataset.action === "kill" ? "KILL_NODE" : "REVIVE_NODE";
  fetch("/api/sim/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, targetNodeId: btn.dataset.bus }),
  });
});

document.getElementById("startBtn").addEventListener("click", () =>
  fetch("/api/sim/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: "START" }),
  })
);
document.getElementById("stopBtn").addEventListener("click", () =>
  fetch("/api/sim/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: "STOP" }),
  })
);
document.getElementById("speedRange").addEventListener("change", (e) =>
  fetch("/api/sim/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: "SET_SPEED", simSpeedMultiplier: Number(e.target.value) }),
  })
);

const logEl = document.getElementById("log");
socket.on("sighting", (s) => {
  const line = document.createElement("div");
  line.textContent = `[${new Date(s.timestampMs).toLocaleTimeString()}] ${s.busId} sighted at ${s.stopId} (rssi ${s.rssi}dBm)`;
  logEl.prepend(line);
  while (logEl.children.length > 40) logEl.removeChild(logEl.lastChild);
});

socket.on("state", renderState);
