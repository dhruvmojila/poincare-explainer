import { sarkarLayout, type SarkarLayout, type TreeNode } from 'poincare-ball';
import { ball } from './draw';
import { mulberry32 } from './draw';

/**
 * An illustrative taxonomy of athletic performance (not the paper's data): 6 domains →
 * 18 areas → 54 topics → 2–3 leaves each, about 200 nodes, depth 4. The labels exist so
 * that chapter 02 can be queried by text; the shape (6, 3, 3, 2–3) is what matters.
 */
const TAXONOMY: Array<[string, Array<[string, string[]]>]> = [
  ['training', [
    ['endurance', ['aerobic base', 'threshold work', 'intervals']],
    ['strength', ['maximal strength', 'power', 'hypertrophy']],
    ['speed', ['acceleration', 'top speed', 'agility']],
  ]],
  ['biomechanics', [
    ['gait', ['stride length', 'stride rate', 'ground contact']],
    ['joints', ['knee', 'hip', 'ankle']],
    ['forces', ['ground reaction', 'torque', 'impulse']],
  ]],
  ['physiology', [
    ['energy systems', ['phosphocreatine', 'glycolysis', 'oxidative']],
    ['cardiovascular', ['heart rate', 'stroke volume', 'VO2 max']],
    ['muscle', ['fibre types', 'contraction', 'fatigue']],
  ]],
  ['nutrition', [
    ['macronutrients', ['carbohydrate', 'protein', 'fat']],
    ['hydration', ['fluid loss', 'electrolytes', 'rehydration']],
    ['timing', ['pre-session meal', 'during session', 'recovery meal']],
  ]],
  ['recovery', [
    ['sleep', ['sleep duration', 'sleep quality', 'naps']],
    ['load management', ['monitoring', 'tapering', 'deload']],
    ['therapy', ['massage', 'cold water', 'compression']],
  ]],
  ['psychology', [
    ['motivation', ['goal setting', 'self-talk', 'intrinsic drive']],
    ['attention', ['focus cues', 'distraction', 'flow']],
    ['stress', ['arousal', 'anxiety', 'coping']],
  ]],
];
const LEAF_FACETS = ['basics', 'measurement', 'adaptation', 'case notes', 'pitfalls'];
export const BIG_ROOT = 'athletic performance';

/** The labelled ~200-node tree shared by chapters 01 and 02. Node ids are the labels. */
export function makeBigTree(seed = 7): TreeNode {
  const rand = mulberry32(seed);
  const seen = new Set<string>();
  const mk = (id: string, children?: TreeNode[]): TreeNode => {
    if (seen.has(id)) throw new Error(`duplicate label in the taxonomy: ${id}`);
    seen.add(id);
    return children ? { id, children } : { id };
  };
  let t = 0;
  return mk(
    BIG_ROOT,
    TAXONOMY.map(([domain, areas]) =>
      mk(
        domain,
        areas.map(([area, topics]) =>
          mk(
            area,
            topics.map((topic) => {
              const k = rand() < 0.65 ? 2 : 3;
              const facets = Array.from({ length: k }, (_, j) => `${topic} ${LEAF_FACETS[(t + j) % LEAF_FACETS.length]}`);
              t++;
              return mk(topic, facets.map((f) => mk(f)));
            }),
          ),
        ),
      ),
    ),
  );
}

/** Hyperbolic edge length of the big tree (drawing scale, shared by chapters 01 and 02). */
export const TAU1 = 1.1;
let bigTreeCache: TreeNode | null = null;
let bigLayoutCache: SarkarLayout | null = null;
export function bigTree(): TreeNode {
  if (!bigTreeCache) bigTreeCache = makeBigTree(7);
  return bigTreeCache;
}
/** The big tree's Sarkar layout (fan π keeps siblings away from the parent's side). */
export function bigTreeLayout(): SarkarLayout {
  if (!bigLayoutCache) bigLayoutCache = sarkarLayout(bigTree(), { tau: TAU1, ball, fan: Math.PI });
  return bigLayoutCache;
}

export function countNodes(t: TreeNode): number {
  return 1 + (t.children ?? []).reduce((s, c) => s + countNodes(c), 0);
}

export function countLeaves(t: TreeNode): number {
  return t.children && t.children.length ? t.children.reduce((s, c) => s + countLeaves(c), 0) : 1;
}

const n = (id: string, children?: TreeNode[]): TreeNode => (children ? { id, children } : { id });

/**
 * A generic textbook sketch of human anatomy (not the paper's data):
 * body → systems → regions → muscle groups → muscles. 43 nodes, depth 4.
 */
export const anatomy: TreeNode = n('body', [
  n('musculoskeletal', [
    n('lower limb', [
      n('quadriceps', [n('rectus femoris'), n('vastus lateralis'), n('vastus medialis')]),
      n('hamstrings', [n('biceps femoris'), n('semitendinosus')]),
      n('calf', [n('gastrocnemius'), n('soleus')]),
      n('gluteal', [n('gluteus maximus'), n('gluteus medius')]),
    ]),
    n('trunk', [
      n('abdominals', [n('rectus abdominis'), n('obliques')]),
      n('back', [n('erector spinae'), n('latissimus dorsi')]),
    ]),
    n('upper limb', [
      n('shoulder', [n('deltoid'), n('rotator cuff')]),
      n('arm', [n('biceps brachii'), n('triceps brachii')]),
      n('chest', [n('pectoralis major')]),
    ]),
  ]),
  n('cardiovascular', [n('heart'), n('arteries'), n('veins')]),
  n('nervous', [n('brain'), n('spinal cord'), n('motor neurons')]),
  n('respiratory', [n('lungs'), n('diaphragm')]),
]);

/** Hyperbolic edge length for the anatomy hierarchy: distance from the origin ≈ depth. */
export const TAU3 = 1.0;
let anatomyCache: SarkarLayout | null = null;
/** The anatomy tree's Sarkar layout, shared by chapters 03 and 04 so the crossfade is seamless. */
export function anatomyLayout(): SarkarLayout {
  if (!anatomyCache) anatomyCache = sarkarLayout(anatomy, { tau: TAU3, ball, fan: Math.PI * 1.1, rootAngle: Math.PI / 4 });
  return anatomyCache;
}

/* ---------------- chapter 04: timestamped memories ---------------- */

export type MemoryKind = 'note' | 'log' | 'fact';

export interface MemoryItem {
  /** Node of the anatomy tree the memory is about. */
  node: string;
  text: string;
  /** Age in days when the time control is at 0. */
  age: number;
  kind: MemoryKind;
  /** Angle (radians) of the memory around its node, in the node's local frame. */
  angle: number;
}

/** Stability multiplier per kind: a durable fact forgets 12× slower than a clinical note. */
export const STABILITY: Record<MemoryKind, number> = { note: 1, log: 3, fact: 12 };

/** Twelve synthetic memories about the anatomy tree (illustrative, not the paper's data). */
export const memories: MemoryItem[] = [
  { node: 'hamstrings', text: 'note: tightness after 400 m repeats', age: 1, kind: 'note', angle: 0.6 },
  { node: 'hamstrings', text: 'eccentric load in late swing is the strain mechanism', age: 400, kind: 'fact', angle: -0.9 },
  { node: 'hamstrings', text: 'log: three sets of eccentric curls, no pain', age: 9, kind: 'log', angle: 2.2 },
  { node: 'gluteal', text: 'hip-extensor weakness shifts load to the hamstrings', age: 300, kind: 'fact', angle: 0.4 },
  { node: 'calf', text: 'at sprint speed the soleus carries the larger share', age: 500, kind: 'fact', angle: -0.5 },
  { node: 'calf', text: 'note: calf cramped in the final 100 m', age: 3, kind: 'note', angle: 1.6 },
  { node: 'quadriceps', text: 'note: right rectus femoris tight on palpation', age: 20, kind: 'note', angle: 0.9 },
  { node: 'back', text: 'note: trunk lean increases in the last 100 m (video)', age: 6, kind: 'note', angle: 0.3 },
  { node: 'lungs', text: 'log: VO2 test rescheduled', age: 15, kind: 'log', angle: 0.8 },
  { node: 'heart', text: 'log: resting heart rate 48, stable', age: 30, kind: 'log', angle: -0.6 },
  { node: 'shoulder', text: 'note: arm carriage asymmetric at top speed', age: 45, kind: 'note', angle: 0.5 },
  { node: 'arm', text: 'log: no upper-body changes planned', age: 60, kind: 'log', angle: -0.4 },
];

/* ---------------- chapter 05: decomposition and allocation ---------------- */

export interface SubTask {
  id: string;
  role: string;
  focus: string;
  /** Expected information gain G(q_i, I). */
  gain: number;
  /** Cost C(I). */
  cost: number;
  /** Depth of the sub-task in the domain hierarchy, read from the memory. */
  depth: number;
}

/** Shaped after a sample run of poincare-orchestra: four foci, four roles, one below budget. */
export const QUERY = 'An athlete’s calf tightens in the last 100 m of 400 m repeats. Plan the next fortnight.';
export const subTasks: SubTask[] = [
  { id: 'q1', role: 'physiologist', focus: 'tissue load and recovery', gain: 0.34, cost: 1.6, depth: 2 },
  { id: 'q2', role: 'biomechanist', focus: 'late-swing mechanics at top speed', gain: 0.32, cost: 3.0, depth: 4 },
  { id: 'q3', role: 'strength coach', focus: 'eccentric programme for the fortnight', gain: 0.36, cost: 1.2, depth: 3 },
  { id: 'q4', role: 'analyst', focus: 'trend across session logs', gain: 0.18, cost: 2.0, depth: 1 },
];
/** A sub-task is skipped when its gain per cost does not clear this fraction of the best ratio. */
export const BUDGET_FRACTION = 0.33;

/* ---------------- chapter 06: provider traces ---------------- */

export interface ProviderTrace {
  id: string;
  latency: number[];
  tokens: number[];
  density: number[];
}

export const REQUESTS = 24;
export const DEGRADE_FROM = 9;

/** Deterministic traces: provider-b degrades from request 9 (latency up, length and density down). */
export function makeTraces(): ProviderTrace[] {
  const rand = mulberry32(42);
  const noise = (s: number) => (rand() - 0.5) * 2 * s;
  const mk = (id: string, lat: number, tok: number, den: number, degrade: boolean): ProviderTrace => {
    const t: ProviderTrace = { id, latency: [], tokens: [], density: [] };
    for (let i = 0; i < REQUESTS; i++) {
      let f = 0;
      if (degrade && i >= DEGRADE_FROM) f = Math.min(1, (i - DEGRADE_FROM + 1) / 5);
      t.latency.push(lat * (1 + 4.5 * f) + noise(lat * 0.09));
      t.tokens.push(Math.round(tok * (1 - 0.68 * f) + noise(tok * 0.07)));
      t.density.push(den * (1 - 0.55 * f) + noise(0.03));
    }
    return t;
  };
  return [mk('provider-a', 420, 150, 0.62, false), mk('provider-b', 380, 140, 0.6, true), mk('provider-c', 510, 160, 0.58, false)];
}

/* ---------------- chapter 07: synthesis candidates ---------------- */

export const OBJECTIVES = ['coverage', 'density', 'agreement', 'recency', 'cost'] as const;
export type Objective = (typeof OBJECTIVES)[number];
export interface Candidate {
  id: string;
  f: Record<Objective, number>;
}
/** Seven synthetic candidate responses (scored live by eq. 7). Cost is a score: 1 = cheapest. */
export const candidates: Candidate[] = [
  { id: 'R1', f: { coverage: 1.0, density: 1.0, agreement: 0.12, recency: 0.94, cost: 0.17 } },
  { id: 'R2', f: { coverage: 0.67, density: 1.0, agreement: 0.0, recency: 0.98, cost: 0.32 } },
  { id: 'R3', f: { coverage: 0.85, density: 0.8, agreement: 0.45, recency: 0.9, cost: 0.4 } },
  { id: 'R4', f: { coverage: 0.6, density: 0.7, agreement: 0.7, recency: 0.85, cost: 0.65 } },
  { id: 'R5', f: { coverage: 0.45, density: 0.6, agreement: 0.8, recency: 0.7, cost: 0.85 } },
  { id: 'R6', f: { coverage: 0.75, density: 0.35, agreement: 0.6, recency: 0.6, cost: 0.55 } },
  { id: 'R7', f: { coverage: 0.9, density: 0.9, agreement: 0.3, recency: 0.5, cost: 0.25 } },
];
export const EPS: Partial<Record<Objective, number>> = { coverage: 0.5, cost: 0.2 };
