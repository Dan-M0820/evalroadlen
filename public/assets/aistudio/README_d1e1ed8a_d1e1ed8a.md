# RoadLens: Bayombong and Solano

A road editor and traffic simulation. Roads and buildings come from OpenStreetMap, but the map you look at is drawn by the app itself (no satellite photo, no tiles), so you see roads, building squares and traffic, nothing else.

## Run it
```
node server.js        # then open http://localhost:8080   (other port: PORT=3000 node server.js)
node --test tests/*.test.js   # engine tests (no browser needed)
```
Needs Node 18+ only. There is nothing to `npm install`. (ES modules do not load from `file://`, which is why there is a tiny server.)

## Get the real Bayombong and Solano map
On first start the app shows a synthetic demo town, then tries to download the real roads and buildings (Overpass API, the only outside service used). If that fails, press **Load real roads (OpenStreetMap)** in "Map and layers". The download is stored in your browser, so it only happens once.
If your network blocks Overpass: run the query printed by `overpassQuery()` in `src/data/osm.js` on https://overpass-turbo.eu, export the raw JSON, and use **Load file**.
The area boxes in `src/data/osm.js` (`AREAS`) are approximate. Adjust them if an edge of town is cut off.

## New: hotspots, controls and "what happens here?"
- **Pin hotspot**: click the map to drop a school, market, terminal, hospital, church or office. It pulls trips in (or sends them out, or both) with a strength 1-10, a reach in metres and active hours. Drag a pin to move it. The glowing circle is its reach. Trips to a hotspot are counted, so you can see how long they take.
- **Add stop light**: click a road, at a junction or anywhere mid-block, to place a traffic light, stop sign, yield sign or pedestrian crossing. Then tune it under *Selected*: green times, all-red gap, cycle offset, which road has priority at a stop or yield, discharge gap, active hours, banned turns.
- **Split road**: cut a long road in two so each half can have its own speed, direction, closure or vehicle restrictions.
- **Per road**: type, lanes, speed limit, flow direction, side friction (parking and market stalls slow everyone down), which vehicle types are allowed, or close the road completely.
- **Selected = live view**: click any road, junction or hotspot to see its level of service (A-F), vehicles now, average speed, stopped vehicles, flow in vehicles per hour, queues per approach and a 30-minute chart.
- **Test what your change does**: with something selected press *Run baseline test* (10 simulated minutes of seeded, identical traffic), change the road or junction, press the button again, and read the before/after table for that spot and for the whole town.

## Workbench: edit a small copy, then apply to the town
Select a road, junction or hotspot, then press **Open workbench** (radius 300, 500 or 800 m). The app copies just that area into a separate session: only those roads are simulated, so edits and tests are fast, and the town map is not touched. Add stop lights, change speeds or directions, close roads, draw, pin hotspots and run the before/after test there. Then:
- **Apply to town** merges your changes into the town map in one step (one rebuild).
- **Discard** throws the copy away; the town is exactly as before.
While a workbench is open, loading, clearing and saving the town are blocked so the small copy can never be saved over the whole map.
How the traffic is matched: roads leaving the area act as gates for through traffic, and the workbench's traffic level is tuned so the copied roads carry about as many vehicles as they did on the town map. For this, let the town map run for about 90 seconds (without edits) before opening the workbench; otherwise it uses a rough 25% guess and says so. It is an approximation, so compare before/after runs inside the workbench rather than against the town numbers.

## What you can do
- **Roads** are classified from the OSM tag: highway, boulevard, street, residential road, barangay lane. Change any road's type, lanes, speed limit and **flow direction** (two-way, one-way either way). Tick "apply to all segments with this name" to change a whole street at once. Draw new roads (snap to existing ones to make junctions).
- **Colours**: each direction of each road is coloured green / yellow / red from simulated speed and how full the road is. Switch to "Road types" colouring for the classification view.
- **Vehicles** are dots, one colour per type (motorcycle, tricycle, car, jeepney, truck, plus your own types). Click a dot to see that driver and follow it.
- **Driver tendencies** per type: following gap, speed vs limit, acceleration, aggressiveness, how often they avoid jams, how different individuals are, passenger stops (tricycle / jeepney loading). Each driver is sampled around the type average.
- **Traffic**: day type, time of day, hourly demand bars, overall volume, vehicle mix. Trips start where there are more buildings and prefer nearby destinations (gravity model).
- **Junctions**: free flow, stop, traffic light (with active hours), banned turns. **Rules**: ban a vehicle type or cap speed on a road or road type in a time window.
- **Efficiency**: average delay per trip, a ranked list of bottleneck roads, "Mark as original" and "Suggest improvement" (tries extra lanes or a traffic light on identical seeded traffic and reports which helps most).
- Save / load the whole project as JSON, export roads as GeoJSON.

## Code layout
```
index.html            page shell
server.js             zero-dependency static server
src/config.js         road classes, default vehicle profiles, demand
src/engine/           no DOM: geo, network (graph), router (A*), sim, rules, clock, analyze
src/data/             osm (Overpass), demo town, store (all user data), persist (IndexedDB)
src/render/           view (camera), draw (canvas map)
src/ui/               editor (mouse), panels (sidebar)
src/main.js           wires it together
tests/                node:test for the engine
```

## Assumptions to replace with your own observations
Lane width 3.3 m, default speeds per road class, hourly demand curve, driver numbers, the 4 trips/s peak spawn rate, the 2.5 km trip-distance preference. All are in `src/config.js`, `src/engine/sim.js` or editable in the app.

## Limits (be upfront about these in your write-up)
- Single-lane-change-free model: vehicles pick a lane when they enter a road and do not overtake.
- Traffic lights are two-phase (east-west / north-south). No pedestrians or parking.
- OSM may be incomplete (missing roads, wrong one-way tags, few mapped buildings). Check it against what you know of the town.
- Results are simulation output, not engineering approval.
- Rebuilding after an edit refills the map with fresh traffic, so compare before/after with "Suggest improvement" or "Mark as original", not by eye.

Map data © OpenStreetMap contributors (ODbL).
