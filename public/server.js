/**
 * AeroTrack-Transit — VERY BASIC functional prototype
 * ----------------------------------------------------
 * This collapses the full 12-module architecture (see the original
 * scaffold's README.md) into ONE runnable process, for demo purposes:
 *
 *   04-simulation-engine  -> tickSimulation() below (fake GPS/ESP-NOW sightings)
 *   05-ingestion-service  -> onSighting() (records sighting, updates bus state)
 *   06-eta-ml-service     -> computeEta() (straight-line/avg-speed, NOT ML)
 *   08-api-gateway        -> the Express routes below
 *   09/10/11 (dashboard/  -> public/index.html (single page, Leaflet map)
 *     mobile/admin)
 *
 * Message shapes loosely follow 03-shared-protocol-spec/schemas/*.json
 * (sighting, eta_response, sim_control) so this can later be split back
 * into the real microservices without renaming fields.
 *
 * Run:  npm install && npm start   -> http://localhost:3000
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

const CITY_ID = "demo-city";

// ---------------------------------------------------------------------------
// 1. STATIC ROUTE DATA (stand-in for 07-database-schema's routes/stops tables)
//    A simple circular loop of stops. Swap these lat/lngs for a real route.
// ---------------------------------------------------------------------------
const STOPS = [
  { id: "STP-01", name: "Central Station", lat: 11.0168, lng: 76.9558 },
  { id: "STP-02", name: "Gandhi Market", lat: 11.0205, lng: 76.9640 },
  { id: "STP-03", name: "College Road", lat: 11.0270, lng: 76.9700 },
  { id: "STP-04", name: "Tech Park", lat: 11.0330, lng: 76.9650 },
  { id: "STP-05", name: "Riverside", lat: 11.0300, lng: 76.9550 },
  { id: "STP-06", name: "Old Town", lat: 11.0220, lng: 76.9500 },
];

const ROUTE_ID = "ROUTE-01";
const AVG_SPEED_KMPH = 25; // used for both movement + naive ETA maths

// ---------------------------------------------------------------------------
// 2. IN-MEMORY BUS STATE (stand-in for what 05-ingestion-service would write
//    to a DB / cache). Each bus has a position expressed as "segment index +
//    fraction along that segment" so it's trivial to interpolate lat/lng.
// ---------------------------------------------------------------------------
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const segmentLengths = STOPS.map((s, i) =>
  haversineMeters(s, STOPS[(i + 1) % STOPS.length])
);

function makeBus(id, startSegment) {
  return {
    busId: id,
    routeId: ROUTE_ID,
    cityId: CITY_ID,
    segment: startSegment, // index into STOPS: current->next stop
    frac: Math.random(), // 0..1 progress along that segment
    alive: true, // toggled by admin "kill node" demo
    lastSightingStopId: STOPS[startSegment].id,
    lastSeenTimestampMs: Date.now(),
  };
}

const BUSES = [
  makeBus("BUS-101", 0),
  makeBus("BUS-102", 2),
  makeBus("BUS-103", 4),
];

let simSpeedMultiplier = 8; // demo runs faster than real time by default
let running = true;

// ---------------------------------------------------------------------------
// 3. NAIVE ETA CALC (stand-in for 06-eta-ml-service; no ML, just physics)
//    Mirrors 03-shared-protocol-spec/schemas/eta_response.json shape.
// ---------------------------------------------------------------------------
function computeEta(bus) {
  const speedMps = (AVG_SPEED_KMPH * 1000) / 3600;
  const predictions = [];
  let remainingOnCurrentSeg =
    segmentLengths[bus.segment] * (1 - bus.frac);
  let cumulativeMeters = remainingOnCurrentSeg;
  let seg = bus.segment;

  for (let hop = 0; hop < STOPS.length; hop++) {
    const nextStopIdx = (seg + 1) % STOPS.length;
    predictions.push({
      stopId: STOPS[nextStopIdx].id,
      stopName: STOPS[nextStopIdx].name,
      etaSeconds: Math.round(cumulativeMeters / speedMps),
      confidence: bus.alive ? Math.max(0.4, 0.95 - hop * 0.12) : 0,
    });
    seg = nextStopIdx;
    cumulativeMeters += segmentLengths[seg];
  }
  return { busId: bus.busId, predictions, modelVersion: "naive-avg-speed-0.1" };
}

// ---------------------------------------------------------------------------
// 4. SIMULATION TICK (stand-in for 04-simulation-engine emitting "sighting"
//    events + 01/02 firmware). Moves each alive bus along the loop and
//    records a "sighting" whenever it crosses a stop.
// ---------------------------------------------------------------------------
function onSighting(sighting) {
  // This is where 05-ingestion-service would validate + persist.
  // Here we just log it and it also feeds bus.lastSightingStopId/timestamp.
  io.emit("sighting", sighting);
}

let nodeSeq = 0;

function tickSimulation() {
  if (!running) return;
  const dtSeconds = 1 * simSpeedMultiplier; // 1 real second of ticking
  const speedMps = (AVG_SPEED_KMPH * 1000) / 3600;

  for (const bus of BUSES) {
    if (!bus.alive) continue;

    const segLenM = segmentLengths[bus.segment];
    let advanceM = speedMps * dtSeconds;
    let fracDelta = advanceM / segLenM;
    bus.frac += fracDelta;

    while (bus.frac >= 1) {
      bus.frac -= 1;
      bus.segment = (bus.segment + 1) % STOPS.length;

      // Bus just "arrived" at STOPS[bus.segment] -> emit a sighting,
      // shape modeled on schemas/sighting.json
      const stop = STOPS[bus.segment];
      bus.lastSightingStopId = stop.id;
      bus.lastSeenTimestampMs = Date.now();
      nodeSeq += 1;
      onSighting({
        schemaVersion: "1.0",
        cityId: CITY_ID,
        stopId: stop.id,
        busId: bus.busId,
        rssi: -40 - Math.floor(Math.random() * 20), // fake signal strength
        timestampMs: bus.lastSeenTimestampMs,
        nodeSeq,
        isSimulated: true,
      });
    }
  }

  broadcastState();
}

function interpolate(bus) {
  const a = STOPS[bus.segment];
  const b = STOPS[(bus.segment + 1) % STOPS.length];
  return {
    lat: a.lat + (b.lat - a.lat) * bus.frac,
    lng: a.lng + (b.lng - a.lng) * bus.frac,
  };
}

function broadcastState() {
  const state = {
    running,
    simSpeedMultiplier,
    stops: STOPS,
    buses: BUSES.map((bus) => {
      const pos = interpolate(bus);
      return {
        busId: bus.busId,
        routeId: bus.routeId,
        alive: bus.alive,
        lat: pos.lat,
        lng: pos.lng,
        lastSightingStopId: bus.lastSightingStopId,
        lastSeenTimestampMs: bus.lastSeenTimestampMs,
        eta: computeEta(bus).predictions.slice(0, 3),
      };
    }),
  };
  io.emit("state", state);
}

setInterval(tickSimulation, 1000);

// ---------------------------------------------------------------------------
// 5. API GATEWAY (stand-in for 08-api-gateway) + ADMIN CONTROLS
//    (stand-in for 11-admin-panel's "kill a node live" demo moment)
// ---------------------------------------------------------------------------
app.get("/api/routes", (req, res) => {
  res.json({ routeId: ROUTE_ID, cityId: CITY_ID, stops: STOPS });
});

app.get("/api/buses", (req, res) => {
  res.json(
    BUSES.map((bus) => ({
      ...bus,
      ...interpolate(bus),
    }))
  );
});

app.get("/api/eta/:busId", (req, res) => {
  const bus = BUSES.find((b) => b.busId === req.params.busId);
  if (!bus) return res.status(404).json({ error: "bus not found" });
  res.json(computeEta(bus));
});

// Mirrors schemas/sim_control.json's command enum
app.post("/api/sim/control", (req, res) => {
  const { command, targetNodeId, simSpeedMultiplier: newSpeed } = req.body || {};
  switch (command) {
    case "START":
      running = true;
      break;
    case "STOP":
      running = false;
      break;
    case "KILL_NODE": {
      const bus = BUSES.find((b) => b.busId === targetNodeId);
      if (bus) bus.alive = false;
      break;
    }
    case "REVIVE_NODE": {
      const bus = BUSES.find((b) => b.busId === targetNodeId);
      if (bus) {
        bus.alive = true;
        bus.lastSeenTimestampMs = Date.now();
      }
      break;
    }
    case "SET_SPEED":
      if (typeof newSpeed === "number" && newSpeed > 0) {
        simSpeedMultiplier = newSpeed;
      }
      break;
    default:
      return res.status(400).json({ error: "unknown command" });
  }
  broadcastState();
  res.json({ ok: true, running, simSpeedMultiplier });
});

io.on("connection", (socket) => {
  broadcastState(); // send current state immediately to new client
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`AeroTrack-Transit prototype running: http://localhost:${PORT}`);
});
