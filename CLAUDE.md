# Swachh Fleet World

A 3D "living world" simulation of smart solid-waste collection and fleet logistics for a real Bengaluru ward
cluster, built on real geography (OpenStreetMap) and real published calibration figures, with what-if scenarios.
Built from scratch; it follows the same template as `../World-Builder/docs/World_Prompt_Pack.pdf` (5 blocks: World,
Life, Interaction, Dashboard, Extras) but shares no code with it.

The current spec lives in `docs/requirements.md`, the data provenance log in `docs/data-sources.md`, and later the
design in `docs/architecture.md`.

## Workflow: spec-driven + TDD (strict order, with an approval gate between stages)
1. **Plan & Elicit (what and why).** Ask about requirements, edge cases and constraints. Update `docs/requirements.md` and the user stories.
2. **Design & Architecture (how).** Propose the design and component breakdown, and flag security and performance risks. Record decisions in `docs/architecture.md`.
3. **TDD.** Write failing unit/integration tests before any feature code.
4. **Implement & Review.** Strictly typed code. Run lint, typecheck and tests, and fix everything before asking for review.

Never write implementation code until the requirements, architecture and failing tests are defined and approved.

## Rules
- **Stack:** TypeScript (strict), Vite, Three.js, Vitest, Playwright. `vite-plugin-singlefile` produces one self-contained `dist/index.html` that runs offline.
- **Simulation and routing code** (`src/sim/`, `src/routing/`) must not import Three.js or the DOM. It is deterministic with a fixed timestep and a seed.
- **Real data:** every number the app shows or uses carries a provenance tag (`real`, `derived`, `assumed` or `synthetic`) and a source in `docs/data-sources.md`. Never present a synthetic or assumed value as real.
- **Map data** is fetched by scripts in `scripts/data/` and committed as a dated snapshot. The build never calls the network. OpenStreetMap data is ODbL and is credited in the app.
- **No official branding:** real place and agency names may appear as facts, but no government, GBA, BSWML or Swachh Bharat logos or emblems, and the app always says it is an independent simulation.
- **Timezone:** Asia/Calcutta (IST) for the simulated clock.
- **Git:** Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`, `docs:`).
- **Docs:** `docs/` is the single source of truth. Keep it updated in the same change as the code.
