# QA Inventory

This inventory splits user requirements into verifiable checks. Completion reports must only claim items that were verified locally or on GitHub Pages.

## Functional QA

### Automated or Playwright-operable
- Initial load has no visible app error.
- Sample city is visible at startup.
- Vehicles move without user setup.
- Traffic signals cycle through green, yellow, and red.
- Statistics values update over time.
- Straight road placement works by clicking/dragging the grid.
- Cross intersection preset can be added.
- T intersection preset can be added.
- Road deletion works.
- One-way/two-way road mode can be toggled.
- Lane count can be changed between 1 and 3.
- Connected roads are represented as intersections.
- Vehicle add button/mode adds a vehicle.
- Vehicles move along roads.
- Vehicles turn at intersections.
- Vehicles stop behind another vehicle.
- Vehicles restart after space opens.
- Completed trips update throughput/travel stats.
- Signal can be added to an intersection.
- Signal phase cycles are visible.
- Red signals stop vehicles.
- Green signals allow vehicles to proceed.
- Signal green/yellow durations can be changed.
- Signal pattern can be changed per selected signal.
- Congestion overlay toggles on/off.
- Roads show green/yellow/red congestion states.
- Stopped-heavy roads are emphasized.
- Average travel time is visible.
- Average waiting time is visible.
- Throughput is visible.
- Congestion length is visible.
- Average speed is visible.
- Current vehicle count is visible.
- Stopped vehicle count is visible.
- Stats snapshot can be saved.
- Changed settings produce comparison deltas.
- WASD or arrow keys move camera.
- Mouse drag rotates camera.
- Wheel zooms camera.
- Space pauses/resumes.
- R resets camera.
- C toggles congestion overlay.
- Tab toggles stats panel.
- Layout remains usable after resize.

### Requires observation in Playwright screenshots
- Vehicles do not visibly teleport.
- Vehicle orientation follows travel direction.
- Turns appear reasonably smooth.
- Stop/start acceleration appears smooth.
- Severe vehicle overlap is not apparent.
- Signal colors are readable from the default camera.

## Visual QA

### Screenshot and human-observed
- Scene reads as a miniature city.
- Roads, intersections, signals, vehicles, pedestrians, buildings, sidewalks, trees, and crosswalks are identifiable.
- HUD is readable.
- Layout is not cluttered enough to block core operation.
- Road edit mode is visually distinct.
- Road connections are legible after adding roads.
- One-way direction is visually indicated.
- Lane count differences are visible.
- Deleting roads does not break rendering.
- Congestion overlay green/yellow/red is immediately legible.
- Vehicles and signals remain visible under congestion overlay.
- Congested sections are intuitive.
- Stats and comparison text are readable.
- HUD and 3D scene do not incoherently overlap.
- Text does not disappear into the background.
- Wide, portrait, and small viewport screenshots do not show clipping/overflow that prevents use.
- Canvas aspect ratio remains correct on resize.

## Deployment QA

- GitHub repository exists and is public.
- CI/CD workflow builds on push to main.
- GitHub Pages deploy completes successfully.
- Published GitHub Pages URL opens.
- Published app loads under repository subpath.
- Published app has no missing asset/base-path failure.
- Published app supports initial view, vehicle motion, signal cycling, road placement, vehicle add, congestion toggle, and stats display.

## Exploratory Pass

- Spend 30 to 90 seconds changing roads, vehicles, signal timing, congestion overlay, and stats snapshot.
- Try to create both heavier congestion and improved flow.
- Record any visual, interaction, performance, or logic issue found.
