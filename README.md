# AeroTrack-Transit — Basic Functional Prototype (SIH 2026)

A single-process, runnable demo of the AeroTrack-Transit idea — collapses
the full 12-module scaffold (see the original scaffold's `README.md` module
map) into one app so you can demo it in minutes, no hardware/MQTT/DB needed.

Maps to the original modules like this:

| Original module              | Here                                              |
|-------------------------------|----------------------------------------------------|
| 04-simulation-engine          | `tickSimulation()` in `server.js`                  |
| 05-ingestion-service           | `onSighting()` in `server.js`                      |
| 06-eta-ml-service              | `computeEta()` — naive avg-speed physics, not ML   |
| 08-api-gateway                 | Express routes in `server.js`                      |
| 09/10/11 dashboard/app/admin  | `public/index.html` + `app.js` (one page)          |
| 03-shared-protocol-spec        | Message shapes loosely follow `sighting.json` / `eta_response.json` / `sim_control.json` |

## Run it

```bash
npm install
npm start
```

Open **http://localhost:3000**. You'll see:
- 3 simulated buses moving around a 6-stop loop route on a live map
- Real-time ETA to the next stops per bus (sidebar)
- A live "sighting" event log (mimics stop nodes hearing a bus over ESP-NOW)
- **Kill node / Revive** buttons per bus — the "kill a node live during the
  demo" moment the original README calls out as the strongest judge moment
- A sim-speed slider (run the demo faster than real time)

## What's simplified vs. the full architecture

- No MQTT broker, no database, no Docker — everything is in-memory in one
  Node process; restart to reset state.
- No real firmware / RS-485 / ESP-NOW — `tickSimulation()` fakes GPS-like
  motion and stop "sightings" directly.
- ETA is a straight average-speed calculation, not the Random Forest / ML
  model described in `06-eta-ml-service/SPEC.md`.
- One hardcoded route/city — swap the `STOPS` array in `server.js` for real
  stop coordinates.

## Where to go next

Once this demo lands, you can graduate pieces back out to the full
scaffold — e.g. swap `computeEta()` for a real call to a trained model
service, or point `onSighting()` at a real MQTT topic so `01`/`02` firmware
can plug in directly, since the message shapes already match
`03-shared-protocol-spec`.
