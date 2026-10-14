# Swachh Fleet World — Requirements

> Status: **APPROVED 2026-10-14** (Stage 1: Plan & Elicit). Every **(default)** below was accepted as proposed,
> and the open questions in §13 were settled on their defaults. Stage 2 then confirmed the exact ward list (D1) and
> corrected the population basis (W-5). Both are marked *Stage 2 update*.
> **Change requests after M2 (2026-10-14):** CR-1 stops drawing buildings and CR-2 adds floating 3D place labels.
> Both are listed in §15 and marked *CR-n* where they change a requirement.
> **M3 (dynamic routing): complete and approved 2026-10-14** (§4 "M3: Dynamic routing"; results in architecture
> §10.10).
> Source: the brief "Smart Solid Waste Management & Fleet Logistics (Swachh Bharat Urban Fleets)", the 5-block
> World Prompt Pack template, the decisions in §1, and the research in `docs/data-sources.md`.

## 1. Decisions so far

| # | Decision | Choice |
|---|----------|--------|
| D1 | Place | **A real Bengaluru ward cluster.** HSR Layout + Koramangala + Agara, with the real KCDC compost plant at Kudlu Gate on the south-east edge. *Stage 2 update:* the exact cluster is **7 contiguous wards of the Bengaluru South City Corporation** (GBA 2025 delimitation): 29 Kormangala West, 28 Kormangala East, 30 Jakkasandra, 72 HSR Layout, 71 Agara, 68 Mangammana Palya and 69 Hosapalya (which contains KCDC). Total **11.92 km²**. Ward names keep the official spelling ("Kormangala"). |
| D2 | Map fidelity | **Real OpenStreetMap streets and building footprints**, baked into the file as a dated snapshot. Streets, water and parks are drawn in the toy-like clay style. Route distances are real-world metres. *CR-1:* buildings are not drawn; their footprints still size the households. |
| D3 | Scenarios | **All four families:** static vs dynamic routing (the headline), fleet disruptions, seasonal and festival surges, infrastructure changes (§7). |
| D4 | Codebase | **Fresh from scratch** in a new repo, `Swachh-Fleet-World`. Same workflow as World-Builder, no shared code. |
| D5 | Stack | (default) **TypeScript (strict), Vite, Three.js, Preact + signals, Vitest, Playwright**, bundled by `vite-plugin-singlefile` into **one offline `index.html`**. |
| D6 | Real vs simulated | **Real geography and real published calibration figures; synthetic live streams.** No public live bin-sensor or truck-GPS feed exists, so sensor readings, GPS tracks and attendance are simulated, calibrated to real figures, and always labelled "Simulated" (§8). A later milestone adds import of real feeds (§9). |
| D7 | Bengaluru's actual collection model | (default) **Model what Bengaluru really does**, with smart bins as the intervention. Collection is **door-to-door by auto-tippers** (about 1 per 1,000 households), which hand waste to **compactors at secondary transfer points**, which haul to **processing (KCDC) or the landfill**. Black spots (garbage vulnerable points) form where streets are skipped or waste is dumped. **Ultrasonic sensors** sit on market and commercial bins, transfer-point containers and known black spots, not on every street (Bengaluru has resisted community bins). See O-3. |
| D8 | Comparison method | (default) **Shadow twin.** A second, invisible simulation with the same seed runs the baseline (static routes, no scenario), and the KPI cards show live deltas against it. *M3 update (M3-2):* the twin runs Static under the same conditions as the live world (weather, absences, breakdowns), so deltas isolate the routing policy. |
| D9 | Branding | (default) Working product name **"KasaFlow Bengaluru"** (*kasa* is Kannada for garbage). Real places and agencies (GBA, BSWML, KCDC) appear as facts. **No government, GBA, BSWML or Swachh Bharat logos or emblems.** A permanent "Independent simulation, not an official system" note is shown. See O-1. |
| D10 | Theme | (default) **Dark first** (graphite #1C1F22) with a light toggle. One accent: **civic green #22A86B**. |

## 2. Product summary

A browser-based, live 3D operations world that feels like a city-builder game. It shows a real Bengaluru
neighbourhood (HSR Layout and Koramangala) built from OpenStreetMap data. Auto-tippers crawl their door-to-door
beats, compactors shuttle between transfer points and the KCDC plant, and black spots appear when streets are
missed. Smart sensors report bin fill levels. Each simulated morning a routing engine rebuilds the day's routes
from those readings and from traffic, and the app compares that against today's fixed routes in fuel, kilometres,
overflowing bins and missed black spots. A scenario lab replays the same city under monsoon flooding, Ganesh
Chaturthi or Diwali surges, absent vehicles, a closed processing plant or a CNG/EV fleet, and reports the
difference.

It is for anyone exploring what dynamic routing could change: civic-tech audiences, city corporation officers,
students and the press. Every figure says whether it is real, derived, assumed or simulated.

## 3. Template slots

| Slot | Value |
|------|-------|
| WHAT IT RUNS | Smart solid-waste collection and fleet logistics for an urban ward cluster |
| NAME | KasaFlow Bengaluru (working name, O-1) |
| PLACE | HSR Layout, Koramangala and Agara, Bengaluru South (real OSM geography) |
| Landmarks and facilities (8) | 1. Secondary transfer points (auto-tipper → compactor handover) · 2. KCDC compost plant, Kudlu Gate (real) · 3. Weighbridge at KCDC · 4. Dry Waste Collection Centre (DWCC) · 5. Vehicle depot / parking yard · 6. Market and commercial streets with smart bins · 7. Black spots (garbage vulnerable points) · 8. Lakes (Agara, Madiwala edge) and parks as real landmarks |
| Vehicles and mobile units (6) | 1. Auto-tipper (primary, door-to-door) · 2. Compactor truck (secondary) · 3. Tipper lorry plus mini excavator (black-spot clearance) · 4. Pourakarmika (sanitation worker) with pushcart · 5. Supervisor bike / inspection jeep · 6. Background traffic (cars, buses, two-wheelers, autos) |
| Accent HEX / background | Civic green **#22A86B** / graphite **#1C1F22** (dark, default) and **#F4F5F2** (light) |
| Main loop | Daily cycle: fill reported → routes planned at 05:30 IST → auto-tippers run beats → hand over at transfer points → compactors haul to KCDC (or the off-map landfill) → weighed and processed (§4, L-1) |
| Other moving things | Pourakarmikas with pushcarts, background traffic, clearance crews at black spots, residents dropping waste at a tipper's whistle |
| Clickable OBJECTS | Every vehicle, smart bin, transfer point, black spot, street beat, KCDC, weighbridge, DWCC, depot |
| AREAS (5) | 1. Overview · 2. HSR Layout · 3. Koramangala · 4. Transfer points · 5. KCDC Kudlu Gate |
| KPI 1 / 2 / 3 | **Overflowing points** (sensored bins at ≥ 100% plus active black spots; sub-line "Bins full n · Black spots n") · **Fuel per tonne** (litres per tonne collected today; sub-line litres and ₹) · **On-time coverage** (% of scheduled beats and points serviced in their window; sub-line "Collected t / generated t") |
| PROCESS tracker (6) | Fill reported → Routed → Vehicle en route → Collected → Transferred → Processed |
| Table tabs (3) | **Bins & points** (ID, type, ward, fill %, predicted full at, last serviced, sensor status) · **Fleet** (vehicle ID, type, status, load kg, fuel, km today, skipped stops) · **Routes** (route ID, vehicle, stops done / planned, km planned vs actual, deviations, ETA) |
| Data UNITS | Fill %, kg and tonnes, litres of fuel, km, km/h, ₹, minutes, ward numbers, IST timestamps |
| Weather modes (4) | Clear · Monsoon downpour (waterlogging closes known low spots) · Winter haze · Heatwave. Night comes from a real sunrise/sunset cycle for Bengaluru on the simulated date. |

## 4. Functional requirements

### M1: Block 1, WORLD (real map)
- **W-1 Real map snapshot.** A script in `scripts/data/` fetches the cluster's bounding box from OpenStreetMap
  (roads with class, one-way and lanes; building footprints with heights or levels where tagged; water; parks;
  named places), projects it to local metres (UTM zone 43N), simplifies it, and writes a dated, committed snapshot.
  The build bundles that snapshot and never calls the network.
- **W-2 Clay style on real geometry.** The style is low-poly and toy-like, with soft shadows and one accent. Roads
  are drawn by class (arterial, collector, residential lane). Lakes and parks come from OSM. *CR-1:* buildings are
  **not drawn**. Their footprints and levels stay in the snapshot because they set how many households each street
  serves; where a height is missing it is derived from the building type, labelled `assumed`.
- **W-3 Facilities.** KCDC, the weighbridge, the depot, the DWCC and the transfer points are placed at real
  coordinates where known. Otherwise they go at plausible sites marked "Location assumed" in their detail panel.
- **W-4 Wards.** Ward boundaries are drawn as soft outlines with ward names and numbers, from the GBA 2025
  delimitation if a boundary file is available (otherwise the newest public file, labelled with its date).
  *CR-2:* the names are floating 3D labels (W-8).
- **W-5 Scale (derived, defaults).** All configurable, all tagged in `docs/data-sources.md`:

  *Stage 2 update:* the Census 2011 population of the 7 wards is **1,56,598** (`real`, from the delimitation
  file), so the Stage 1 figure of ~3,00,000 was too high. All the figures below are now **computed from the config**
  and none are hard-coded. The values shown assume a 2011→2026 growth factor of 1.6, which is `assumed` and gets
  sourced during the M1 data extraction.

  | Quantity | Approx. default | Derivation |
  |---|---|---|
  | Population (2011) | 1,56,598 | Sum of the 7 wards' `TOT_P`, GBA final ward map, Dec 2025 (`real`) |
  | Population (2026) | ~2,50,000 | 2011 × growth factor (`assumed`, *to verify*) |
  | Households | ~64,000 | Population ÷ 3.9 persons per household (`assumed`) |
  | Waste generated | ~100 t/day | Per-capita rate × population; rate = 5,500 t/day ÷ city population (`derived`, *city population to verify*) |
  | Composition | 60% wet, 30% dry, 10% reject | `assumed`, configurable |
  | Auto-tippers | ~65 | 1 per 1,000 households (`real` ratio), rounded up |
  | Compactors | ~6 | Load-driven: waste ÷ ~6 t per load ÷ ~3 trips (`derived`) |
  | Transfer points | 5 | `assumed` |
  | Smart bins (markets, commercial streets) | 120 | `assumed`, a scenario lever |
  | Black spots | ~28 known | 1,555 city-wide scaled by population share (`derived`) |

- **W-6 Instancing.** Repeated objects (trees, bins, people, vehicles) use instancing or merged geometry to stay
  within the draw-call budget (N-2).
- **W-7 Attribution.** "© OpenStreetMap contributors" is visible on the map at all times, with a link to the ODbL.
- **W-8 Floating place labels (CR-2).** Place names are signs in the 3D world, not flat text on the screen: a card
  floating above the place on a thin pin to the ground, always facing the camera, larger when nearer, gently bobbing
  (still when the browser asks for reduced motion), and hidden behind anything nearer. Three groups, shown by zoom:
  **area names** (HSR Layout, Koramangala) when zoomed out to the whole cluster, **ward names** ("South-72 · HSR
  Layout") at the middle zoom, and **facility names** (the transfer points and KCDC Kudlu Gate) when zoomed in.
  Labels never block clicks on the map.

### M1: Block 2, LIFE (simulation)
- **L-1 Daily cycle.** The simulated day (IST) runs:
  1. **Generation.** Every street segment accumulates waste through the day following a household generation curve (morning peak). Smart bins fill at their own rates (markets fill faster, with a peak after market hours).
  2. **Fill reported.** Each sensor reports its fill level every 15 simulated minutes, with realistic noise and a 1% chance of a stuck or offline sensor.
  3. **Routed (05:30 IST).** The routing policy (§5) builds the day's beats and runs. Under **static**, routes are the same every day. Under **dynamic**, they are rebuilt from the readings, backlog, fleet available and forecast traffic.
  4. **Vehicle en route.** Auto-tippers leave the depot and run their door-to-door beats (about 06:00–11:00), stopping along streets. Each fills up to its payload, then drives to its assigned transfer point.
  5. **Transferred.** At a transfer point the auto-tipper tips into a compactor or container. Compactors leave when full or on schedule.
  6. **Processed.** Compactors weigh in at the KCDC weighbridge and unload. If KCDC is at its daily intake cap, they divert to the off-map Mittaganahalli landfill with a modelled travel time (much longer).
- **L-2 Black spots.** A skipped segment, or a segment whose backlog goes over a threshold, raises the chance that a known black spot activates and grows. Active black spots need a clearance crew (tipper lorry plus mini excavator), dispatched by the policy. Untreated spots grow and raise complaints.
- **L-3 Fleet behaviour.** Each vehicle has a fuel model (litres per km by vehicle type and speed, plus idle burn), a payload, a shift window and a driver. Configurable chances of **absence** (default 5% of tippers a day, from the 200–300 a day city figure), **breakdown** mid-shift, and **non-compliance** (skipped stops, early return, route deviation) drive the disruption scenarios. GPS geofencing in the simulation detects deviations and skips.
- **L-4 Traffic.** Road speeds follow a time-of-day curve calibrated to the TomTom 2025 figures (rush-hour average 13.9 km/h; morning 14.6, evening 13.2) and scaled by road class. Background traffic is visual and affects segment speed. Fleet vehicles follow the car ahead and give way at junctions. **Nothing ever overlaps.**
- **L-5 Determinism.** The simulation is deterministic for a seed and a fixed timestep, so tests and scenario comparisons can replay it. Rendering interpolates between steps.
- **L-6 Time scale.** (default) The live view runs at **60×** (a 24 h day takes 24 minutes), with pause and steps of 30×, 60×, 120× and 240×, and "skip to the next morning". The scenario lab (§7) runs headless far faster. Vehicles move at their true simulated speed over real distances. How that looks at high speeds is a Stage 2 design question (R-3).
- **L-7 Live state.** Every agent and facility exposes live state for the UI (status, location, load, fuel, km today, current stop, ETA, fill %, predicted-full time).

### M1: Block 3, INTERACTION
- **I-1** Drag to pan, right-drag to rotate, scroll or pinch to zoom, within map bounds.
- **I-2** Clicking any object glides the camera (eased) to it, and keeps following it if it moves.
- **I-3** The selection gets a pulsing ring and a floating label (e.g. "AT-HSR-031", "Bin KM-114 · 92%").
- **I-4** A detail panel shows live stats, including the provenance tag of each figure.
- **I-5** The area switcher flies between the 5 areas in §3.
- **I-6** Selecting a vehicle draws its planned route, the part already driven, and any skipped stops.
- **I-7** Esc or clicking empty ground clears the selection.

### M2: Block 4, DASHBOARD
- **D-1** Frosted-glass panels over the 3D view.
- **D-2** Top bar: logo, search (vehicle, bin, black spot, street, ward), area switcher, weather menu, IST clock and simulated date, routing policy badge (Static or Dynamic), alerts, day/night toggle, user chip.
- **D-3** 3 KPI cards from §3, computed live, each with a trend and its delta against the shadow twin (D8).
- **D-4** Right detail panel (the styled I-4).
- **D-5** Bottom-left process tracker (6 steps) for the selected bin, point or load, with IST timestamps. With nothing selected it shows today's counts per step.
- **D-6** Tabbed live table with the 3 tabs from §3. Rows can be sorted and filtered, and clicking a row selects the object.
- **D-7** Realistic generated data, no lorem ipsum. Formats (default): vehicle IDs like `AT-HSR-031` (auto-tipper, with a 2–4 letter area code), `CP-BLR-S-07` (compactor) and `CR-BLR-S-02` (clearance crew); bins like `KM-114`; black spots like `GVP-HSR-012`; route IDs like `R-2026-10-14-031`; ward numbers and names from the delimitation. No registration plates and no real driver names (drivers are `DRV-0412`).
- **D-8 Alerts** from the simulation: bin ≥ 90% / overflowing, black spot activated, vehicle absent or broken down, skipped stop or route deviation, KCDC at intake cap (diversion to the landfill), road closed by waterlogging, sensor offline.
- **D-9 Data sources dialog.** Lists every calibration figure with its value, tag, source and date, plus the OSM snapshot date and licence.

### M2: Block 5, EXTRAS
- **X-1 Weather** (each changes visuals and simulation):

  | Mode | Visuals | Simulation |
  |---|---|---|
  | Clear | Default lighting | Baseline |
  | Monsoon downpour | Rain, wet roads with reflections, puddles, water rising at low spots | Speeds −30%; known waterlogging spots close roads (rerouting); wet waste +15% by weight; sensors 3% offline |
  | Winter haze | Low-contrast haze, soft light | Speeds −10% in early morning |
  | Heatwave | Warm grade, shimmer | Wet waste must be collected within 24 h (overflow threshold tightened); odour complaints rise faster at black spots |

- **X-2 Day and night** from real sunrise and sunset for Bengaluru on the simulated date. At night: street lights and vehicle lights (lit windows went with the buildings, CR-1); night clearance runs at black spots.
- **X-3** Mobile: touch gestures, and panels collapse to a bottom sheet.
- **X-4** Theme toggle (dark default, light), remembered per browser. A failure to save it is harmless.

### M3: Dynamic routing (approved 2026-10-14)
Decided by the user on 2026-10-14: the baseline is **calibrated to the real collection figure** before any comparison;
the twin runs **Static under the same conditions**; Dynamic controls **auto-tipper beats, compactor dispatch and
black-spot crews** (smart bins keep their static service); fuel per tonne is **per tonne collected**. Items marked
(default) are proposals to approve or change.

- **M3-1 Policy switch.** The top bar's policy badge becomes a Static / Dynamic switch. The page opens on Static.
  (default) Switching mid-day re-plans the rest of today at once: vehicles finish the street segment or stop they
  are on, then follow the new plan. Switching back to Static restores today's fixed beats for the remaining work.
- **M3-2 Twin = Static, same conditions.** The shadow twin always runs Static under the **same weather, absences,
  breakdowns, sensor faults and waste generation** as the live world, so the KPI deltas show the routing policy's
  effect alone. This replaces D8's "no scenario" and M2's clear-weather twin: in M3, weather by itself no longer
  produces a delta (the X-1 end-to-end test changes accordingly).
- **M3-3 Baseline calibration.** Before Dynamic results are shown, the Static baseline is tuned so that its
  steady-state share of **generated waste collected** sits in the **50–60% band** (the B.PAC 2023 "< 60% collected"
  figure, `real`). Steady state means days 3–7 over 5 seeds, in clear weather. Only `assumed` knobs are tuned (skips,
  early returns, route deviations, breakdowns, black-spot dumping); `real` and `derived` figures such as the 5%
  absence rate stay fixed. Tuned values become `derived (calibrated)` in `docs/data-sources.md`, with the method and
  the target. A test fails if the baseline leaves the band.
  - (default) **Where uncollected waste goes.** Waste left uncollected for over 48 h on a segment is dumped at the
    nearest black spot (which can activate it). A share of the rest leaves the system each day (informal
    collection, burning), so the backlog cannot grow without bound. That share is `assumed`, and set by the
    calibration.
- **M3-4 Forecasts use only what an operator would know.** The Dynamic policy sees only what an operator would have:
  sensor readings (with their noise, stuck sensors and offline gaps), past service records from GPS, and the
  calendar. It never sees the generator's true rates (risk R-4).
  - (default) Sensored points (transfer-point containers, black spots, market and commercial bins) are forecast
    from an hour-of-week profile learned from past readings by exponential smoothing. With less than a day of
    history, the M2 two-point line is used.
  - Street segments have no sensors. Their backlog is estimated as households × the profile rate × the time since
    they were last served.
  - Forecast error (mean absolute error) is measured live and shown in the Data sources dialog.
- **M3-5 Dynamic auto-tipper beats.** At 05:30 IST the beats are re-balanced across the tippers actually present,
  serving streets in order of predicted backlog and time since last service, within payload, shift and
  transfer-point limits.
  - **R-5 fairness:** no segment goes more than 48 h unserved.
  - **Mid-day re-plans** happen only on incidents: a breakdown (the orphaned beat is shared out), a road closure
    (re-routing around it) or a mid-day policy switch.
  - **Deferring streets.** A street may be deferred to tomorrow only when its predicted backlog is low and the
    fairness limit allows it. Each deferral is recorded with its reason.
- **M3-6 Dynamic compactor dispatch.** Compactors go to a transfer point when its container is predicted to reach
  (default) **80%** by their arrival, instead of on a fixed schedule. They respect shift windows and the KCDC intake
  cap: when the cap is predicted to be hit, loads go to the landfill (already modelled), and dispatch is ordered to
  keep diversions to a minimum.
- **M3-7 Dynamic clearance crews.** Black spots are cleared in order of a risk score: size, growth rate, backlog on
  nearby streets, and heatwave. The night window (M2-7, 19:00–21:00) stays. (default) A spot above the critical
  size can also be dispatched in daytime.
- **M3-8 Smart bins stay static** under both policies. Their sensors still feed forecasts, alerts and the tracker.
- **M3-9 Solver (R-2).** A deterministic heuristic, with the exact algorithm chosen in Stage 2. Its work budget is
  counted in **iterations, not wall-clock time**, so a run replays identically on any machine.
  - It runs off the main thread, and the 3D view keeps its frame rate while it solves.
  - Simulated time does not pass while a plan is being made, so the result never depends on machine speed.
  - If a solve fails, today falls back to the static beats and an alert says so.
- **M3-10 Explainability (R-4).**
  - For a Dynamic route, the detail panel lists each stop or street with why it is there: predicted backlog or
    fill, hours since last served, and risk.
  - It also lists deferred or dropped work with the reason: capacity, shift end, road closed, or low backlog within
    the fairness limit.
  - A vehicle's detail shows its re-plans ("Re-planned 08:42 · breakdown of AT-HSR-031").
  - The Routes table gains Policy and Re-plans columns, and a new info alert says "Re-planned: reason".
- **M3-11 Objective weights (R-3).** The defaults are fixed in M3, listed in the Data sources dialog as `assumed`,
  and become editable in the M4 lab.
- **M3-12 Fuel per tonne = per tonne collected.** K-2 changes to fleet litres today ÷ tonnes collected today. This
  resolves the M2 open question, and the KPI-table wording in §3 already matches.
- **M3-13 Performance.** The 05:30 plan for about 70 vehicles takes (default) at most **2 s** of real time on a
  mid-range laptop. Re-plans take at most 0.5 s. The view stays at 60 fps throughout, and "skip to" across 05:30
  still works.

**M3 edge cases (expected behaviour):**
- All tippers in a ward are absent: neighbouring tippers absorb what payload and shift allow, and the rest is
  deferred with reasons.
- A closure cuts off a street: it is deferred as "unreachable (road closed)".
- KCDC is at its cap: the dispatcher sends loads to the landfill and an alert fires.
- Day 1 has no history: the forecasts fall back as in M3-4.
- An offline sensor: the profile forecast is used, and the explanation marks it as low confidence.
- The policy is switched several times in a minute: each switch re-plans once from the current state.
- The solver fails: the static fallback is used and an alert fires.

## 5. Routing (the core of the brief)

- **R-1 Two policies, same world.**
  - **Static (today's practice).** Fixed beats and compactor schedules, generated once from the street network and kept identical every day.
  - **Dynamic.** At 05:30 IST each simulated day: predict each segment's backlog and each sensored point's fill at its service time, choose which streets, transfer points and black spots must be served today, re-balance beats across the vehicles actually present, and solve the routes. *M3 scope (M3-5 to M3-8):* auto-tipper beats, compactor dispatch and clearance crews; smart bins stay static. During the day, re-plan only for incidents (breakdown, road closure, black spot), not continuously.
- **R-2 Solver.** (default) A deterministic heuristic for the capacitated vehicle routing problem with time windows: a construction step (savings or insertion) followed by local search (2-opt, relocate, exchange), with a time budget per solve. Travel times use the time-of-day speed curve on the real road graph, with one-way rules respected. The exact algorithm is chosen in Stage 2.
- **R-3 Objective** (default weights, configurable): minimise overflow-hours and missed black spots first, then fuel, then km, subject to payload, shift length and transfer-point and KCDC capacity.
- **R-4 Explainability.** For any route, show why each stop is there (predicted fill, backlog, black-spot risk) and what was dropped and why.
- **R-5 Fairness guard.** (default) Dynamic routing may not leave any street segment unserved for more than 48 h, so low-fill streets are not starved.

## 6. KPIs and metrics (definitions)
- **K-1 Overflowing points:** sensored bins with true fill ≥ 100% plus active black spots, sampled live; also overflow-hours accumulated today.
- **K-2 Fuel per tonne:** fleet litres today ÷ tonnes **collected** today (*M3-12*; it was "delivered to processing or the landfill" until M2). ₹ uses a configurable diesel and CNG price (`assumed`, with its date).
- **K-3 On-time coverage:** serviced-in-window ÷ scheduled, over beats, bins and black-spot jobs.
- **K-4 Secondary metrics** (detail panels and the scenario lab): km driven, empty km (driving with < 20% load), CO₂ (from fuel, using standard emission factors), skipped stops, driver compliance %, transfer-point dwell, KCDC utilisation, landfill diversions, complaints.

## 7. Scenarios (what-if)

All scenarios run in the live world against the shadow twin (D8), and in the **scenario lab**: a headless batch
runner that simulates N days × M seeds for two configurations in a Web Worker and reports means and spreads.

| # | Family | Scenario | Levers |
|---|---|---|---|
| S-1 | Routing | **Static vs dynamic** (headline) | Policy, re-plan triggers, objective weights |
| S-2 | Routing | Sensor coverage | % of bins with sensors (0–100%), sensors on black spots on/off |
| S-3 | Disruption | Absent vehicles | % of tippers absent (default 5%, range 0–20%) |
| S-4 | Disruption | Breakdowns | Breakdown rate, repair time |
| S-5 | Disruption | Driver non-compliance | Skip and deviation rates; with or without GPS-geofence enforcement |
| S-6 | Seasonal | Monsoon week | Rainfall days, waterlogging spots, speed penalty |
| S-7 | Festival | Ganesh Chaturthi / Diwali / Christmas–New Year | Waste multiplier by type (e.g. flowers and idol waste, packaging), duration, hotspot streets |
| S-8 | Seasonal | Market day / weekend | Market bin fill multipliers |
| S-9 | Infrastructure | KCDC closure or reduced intake (e.g. a protest) | Intake cap, closure days → landfill diversions |
| S-10 | Infrastructure | Transfer point closed or added | Points on/off, new site |
| S-11 | Infrastructure | Fleet change | More compactors; CNG or EV auto-tippers (cost, range, charging time) |
| S-12 | Infrastructure | Segregation compliance | % segregated at source → DWCC dry-waste flow and KCDC load |

- **SC-1** Presets combine levers, e.g. "Ganesh Chaturthi in the rain", "Bad Monday" (12% absent + breakdowns), "KCDC shut for a week".
- **SC-2** The lab result shows a side-by-side table and charts per KPI with spread across seeds, plus the external reference (the ~20% fewer trucks Mumbai study) for context only.
- **SC-3** Results export as CSV and as a printable one-page summary that states the assumptions and provenance.
- **SC-4** Every scenario run is reproducible from a deep link (seed, date, weather, policy, levers).

## 8. Data and provenance requirements
- **P-1** Every calibration value lives in one typed config with `{ value, unit, tag, sourceId, asOf }`. `tag` is `real`, `derived`, `assumed` or `synthetic`.
- **P-2** The UI never shows a simulated value without the "Simulated" tag being reachable (tooltip, detail panel or Data sources dialog).
- **P-3** The OSM snapshot records the fetch date, bounding box, Overpass query and object counts. A test checks the snapshot has not been edited by hand (hash in the manifest).
- **P-4** Conflicting figures (e.g. KCDC capacity) keep all values with sources; the config picks a default and the lab can use the others.
- **P-5** A disclaimer: "Independent simulation using public data. Not an official GBA or BSWML system. Results are model estimates."

## 9. Later: real data import (planned milestone)
- **IM-1** Drop a CSV or JSON of bin readings (`binId, timestamp, fillPct`), a fleet roster, or GPS tracks (`vehicleId, timestamp, lat, lon`) to replace the synthetic stream for a replay day. The schemas are published in `docs/`.
- **IM-2** Imported data stays in the browser. Nothing is uploaded.

## 10. Non-functional requirements
- **N-1 Single file, offline.** `npm run build` produces one `dist/index.html` that runs from `file://` with no network access. Size budget (default): ≤ 15 MB including the map snapshot.
- **N-2 Performance.** 60 fps on a mid-range laptop and ≥ 30 fps on a mid-range phone with ~90 fleet vehicles, ~120 bins, background traffic and the place labels. Draw calls ≤ 200 (laptop) and ≤ 120 (phone). Shadows and background traffic scale by quality tier.
- **N-3 Strictness.** `strict: true`, no `any`; ESLint and typecheck clean.
- **N-4 Testability.** Simulation and routing have no Three.js or DOM dependencies. The routing solver is tested on small instances with known optima and with property tests (capacity, time windows, every required stop served exactly once).
- **N-5 Accessibility.** Keyboard-usable panels, WCAG AA contrast (the accent is used only for fills and icons in light mode if it fails AA as text), `prefers-reduced-motion` respected; charts in the lab have table equivalents.
- **N-6 Data safety.** No real people, plates or driver names. No telemetry, no external calls at runtime.
- **N-7 No official branding** (D9).
- **N-8 Browsers.** The last 2 versions of Chrome, Edge, Safari and Firefox; WebGL 2 required, with a clear message if missing.
- **N-9 Solver budget.** A dynamic re-plan for the whole cluster finishes in ≤ 2 s on a mid-range laptop in a Web Worker without freezing the view.

## 11. Proposed milestones

| Milestone | Scope |
|---|---|
| **M1** World, Life, Interaction | Data pipeline and OSM snapshot; real map in clay style; waste generation; static routes; auto-tippers, compactors, transfer points, KCDC; no-overlap traffic; click and follow |
| **M2** Dashboard and Extras | KPI cards, tracker, tables, alerts, Data sources dialog; weather, real day/night, mobile, theme |
| **M3** Dynamic routing | Sensor model, predictive fill, VRP solver in a worker, static vs dynamic shadow twin, route explainability |
| **M4** Scenario lab | Disruption, seasonal/festival and infrastructure scenarios; presets; batch runs; charts; CSV and summary export |
| **M5** Ship and share | Real data import, deep links, kiosk tour, screenshots, GitHub Pages and releases, README |

## 12. Risks to resolve in Stage 2
- **R-1 Snapshot size.** About 10–12 km² of buildings could be tens of thousands of footprints. Mitigations: quantised coordinates, footprint simplification, merging by tile, and a smaller area if needed.
- **R-2 OSM gaps.** Missing building footprints or wrong one-way tags in parts of the cluster. Mitigation: a coverage report from the fetch script; gaps are shown, not invented.
- **R-3 Time scale vs real distances.** At 60× and above, vehicles crossing real distances look very fast. Options: a "follow" view that drops to 15× while a vehicle is followed, or motion trails.
- **R-4 Solver quality vs time.** The heuristic must beat the static baseline credibly without overfitting to the simulation's own generator. Mitigation: the lab reports results across seeds, with sensor noise and forecast error on.
- **R-5 Credibility.** Results could be quoted as real predictions. Mitigation: provenance tags, the disclaimer, and assumption lists on every export.

## 13. Open questions (resolved 2026-10-14, all on their defaults)
- **O-1 Name and accent.** Resolved: "KasaFlow Bengaluru" with civic green #22A86B.
- **O-2 Exact area.** Resolved: HSR Layout + Koramangala + Agara with KCDC, which became the 7 wards in D1.
- **O-3 Bin model.** Resolved: Bengaluru's real door-to-door model with smart bins at markets, transfer points and black spots (D7).
- **O-4 Agency names.** Resolved: real names (GBA, Bengaluru South City Corporation, BSWML, KCDC) shown as context, with no logos.
- **O-5 Milestone order.** Resolved: M3 (dynamic routing) comes before M4 (scenario lab).

## 14. User stories
- As a **viewer**, I open one file and see real HSR Layout streets come alive at 6 am as auto-tippers start their beats, so I instantly recognise the neighbourhood.
- As a **viewer**, I click an auto-tipper and follow it along its beat to the transfer point, watching its load, fuel and skipped stops update.
- As a **city officer**, I switch the policy from Static to Dynamic and watch fuel per tonne and overflowing points move against the static twin over a simulated week.
- As a **city officer**, I run "Ganesh Chaturthi in the rain" in the scenario lab for 7 days × 10 seeds and export a one-page summary with its assumptions.
- As a **city officer**, I see an alert when a black spot activates, click it, and see which skipped street segments caused it.
- As a **journalist**, I open the Data sources dialog and see which numbers are real, which are derived and which are simulated.
- As a **viewer**, I switch to Monsoon at night and see waterlogged roads close, compactors reroute and the KPIs react.
- *M3:* As a **city officer**, when a tipper breaks down mid-beat under Dynamic, I see an alert, its remaining streets shared out among nearby tippers, and the reason on each affected route.
- *M3:* As a **planner**, I open a Dynamic route and see why each street is on it and which streets were deferred to tomorrow and why, with none left unserved for more than 48 h.
- *M3:* As a **journalist**, I see that the Static baseline is calibrated to the real "< 60% collected" figure, and how, before trusting any Dynamic gain.

## 15. Change requests after M2

| # | Date | Change | Affects |
|---|---|---|---|
| CR-1 | 2026-10-14 | **Stop drawing buildings.** The map shows streets, water, parks, ward outlines, facilities, bins and vehicles. Building footprints stay in the snapshot for the household model, and the snapshot is unchanged. | D2, W-2, W-6, X-2 (no lit windows), N-2 |
| CR-2 | 2026-10-14 | **Floating 3D place labels** for areas, wards and facilities, in the "sign card on a pin" style chosen by the user. They replace the flat ward-name text. | W-4, W-8 |
