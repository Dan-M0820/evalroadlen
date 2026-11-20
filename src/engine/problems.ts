import { armsAt, boxDistance, classify, lanePerms, movements, phaseConflicts } from './junction';
import type { Network } from './network';
import type { EditorProblem, JunctionConfig, Road, TurnMove } from '../types';

// Scans the road network and junction setups for layout or signal issues (lanes leading nowhere, dead-end one-ways, missing green phases).
export function findProblems(roads: Road[], junctions: Record<string, JunctionConfig>, net: Network): EditorProblem[] {
  const out: EditorProblem[] = [];

  for (const n of net.nodes) {
    const J = junctions[n.key];
    const arms = armsAt(roads, n.key);
    const mvs = movements(arms);

    // Check lane turns vs available movements
    if (J && J.lanes && arms.length >= 2) {
      for (const arm of arms) {
        if (arm.inN <= 0) continue;
        const perms = lanePerms(J, arm.id, arm.inN);
        const availTurns = new Set<TurnMove>();
        for (const outArm of arms) {
          if (outArm === arm || outArm.outN <= 0) continue;
          availTurns.add(classify([-arm.u[0], -arm.u[1]], outArm.u));
        }

        perms.forEach((laneMoves, li) => {
          if (!laneMoves.length) {
            out.push({
              id: `empty-${n.key}-${arm.id}-${li}`,
              severity: 'error',
              message: `${arm.road.name} lane ${li + 1} has no allowed turns`,
              nodeKey: n.key,
              xy: [n.x, n.y],
            });
          } else {
            for (const mv of laneMoves) {
              if (!availTurns.has(mv)) {
                out.push({
                  id: `nowhere-${n.key}-${arm.id}-${li}-${mv}`,
                  severity: 'warn',
                  message: `${arm.road.name} lane ${li + 1} allows ${mv === 'L' ? 'left' : mv === 'R' ? 'right' : 'straight'} turn that leads nowhere`,
                  nodeKey: n.key,
                  xy: [n.x, n.y],
                });
              }
            }
          }
        });

        // Check if an available exit turn cannot be reached from any lane
        for (const t of availTurns) {
          if (!perms.some(p => p.includes(t))) {
            out.push({
              id: `blocked-${n.key}-${arm.id}-${t}`,
              severity: 'warn',
              message: `${arm.road.name}: no lane allows ${t === 'L' ? 'left' : t === 'R' ? 'right' : 'straight'} movement`,
              nodeKey: n.key,
              xy: [n.x, n.y],
            });
          }
        }
      }
    }

    // Check signal phase coverage and conflicts
    if (J && J.ctrl === 'signal' && J.phases && J.phases.length && mvs.length) {
      const greenSet = new Set(J.phases.flatMap(p => p.allow));
      const missing = mvs.filter(m => !greenSet.has(m.key));
      if (missing.length) {
        out.push({
          id: `missing-green-${n.key}`,
          severity: 'error',
          message: `Signal at ${arms[0]?.road.name || 'junction'} leaves ${missing.length} movement(s) permanently red`,
          nodeKey: n.key,
          xy: [n.x, n.y],
        });
      }
      const d = boxDistance(arms);
      J.phases.forEach((p, pi) => {
        const cf = phaseConflicts(p.allow, mvs, arms, d);
        if (cf.length) {
          out.push({
            id: `conflict-${n.key}-${pi}`,
            severity: 'warn',
            message: `Signal phase ${pi + 1} at ${arms[0]?.road.name || 'junction'} has ${cf.length} crossing conflict(s)`,
            nodeKey: n.key,
            xy: [n.x, n.y],
          });
        }
      });
    }

    // Dead-end one-way trap inside connected areas
    if (n.deg >= 1 && n.in.length > 0 && n.out.length === 0) {
      out.push({
        id: `trap-in-${n.key}`,
        severity: 'warn',
        message: `One-way dead end at ${n.in[0].road.name}: vehicles enter with no exit`,
        nodeKey: n.key,
        xy: [n.x, n.y],
      });
    }
  }

  return out;
}
