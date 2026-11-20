Attached is `roadlens.zip`, a traffic simulation of Bayombong and Solano (run `node server.js`, open http://localhost:8080; tests: `node --test tests/*.test.js`). Read the code first. `src/engine/junction.js` already has the junction, lane and signal-phase logic; build on it.

**Build a visual road and junction editor.** Today a junction is only a dot and editing is a sidebar of checkboxes. I want to click a junction or road, see it zoomed in from above (in metres), and edit it by clicking and dragging:

1. Click a lane to choose whether it turns left, goes straight, or turns right.
2. Add or remove lanes on each side of a road.
3. Build traffic-light phases visually: pick which movements get green together, set the times, watch the lights change.
4. Set stop, yield or priority for each approach.
5. Drag junctions and roads. Start from templates (cross, T, roundabout) that stay freely editable; a roundabout's ring must be reshapeable.
6. Undo and redo, plus a list of problems (for example, a lane that leads nowhere).

Edits happen in a separate session (the existing "workbench") and only change the map when I press Apply. Cars must actually obey the design: lane turns, signals, giving way.

Keep old saves working and the tests passing. Work in small steps; after each, run the tests, take a screenshot, and tell me what is verified and what is not.
