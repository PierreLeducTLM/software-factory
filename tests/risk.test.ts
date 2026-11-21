import { describe, expect, it } from 'vitest';
import { parseFactoryConfig, type FactoryConfig } from '../src/config/project-config.js';
import { matchesPath, patternsOverlap } from '../src/factory/paths.js';
import { assessDiff, assessSpec, decideMerge, higherRisk, raisedRisk, type RiskFacts } from '../src/factory/risk.js';

const getRisk = (extra = '', low = '{ merge: auto }'): FactoryConfig['risk'] => {
  const parsed = parseFactoryConfig(`
schema: 1
engine: 0.1.0
states: { to_refine: a, spec_review: b, ready_for_dev: c, in_development: d, in_review: e, blocked: f, done: g }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
checks: []
risk:
  low: ${low}
  medium: { merge: human }
  high: { merge: human }
  sensitive_paths: [src/auth/**, src/billing/**, migrations/**]
${extra}`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value.risk;
};

const getFacts = (overrides?: Partial<RiskFacts>): RiskFacts => ({ paths: ['src/export/csv.ts'], lines: 80, capabilities: 1, attempts: 1, warnings: 0, ...overrides });

describe('paths', () => {
  it.each([
    ['**/migrations/**', 'migrations/0001.sql', true],
    ['**/migrations/**', 'apps/billing/migrations/0001.py', true],
    ['**/migrations/**', 'src/migrationsx/a.py', false],
    ['**/*.sql', 'schema.sql', true],
    ['**/*.sql', 'db/seed/data.sql', true],
    ['**/package.json', 'package.json', true],
    ['**/package.json', 'apps/web/package.json', true],
    ['**/package.json', 'apps/web/package.json.bak', false],
    ['.github/**', '.github/workflows/ci.yml', true],
    ['.github/**', 'docs/.github/x', false],
  ])('%s against %s is %s', (pattern, file, expected) => {
    expect(matchesPath(pattern, file)).toBe(expected);
  });

  it.each([
    ['src/billing/**', 'src/billing/**', true],
    ['src/billing/**', 'src/billing/rounding.ts', true],
    ['src/**', 'src/billing/**', true],
    ['src/billing/**', 'src/**', true],
    ['src/billing/**', 'src/billingx/**', false],
    ['src/billing/**', 'src/export/**', false],
    ['**/migrations/**', 'src/export/**', false],
    ['**/migrations/**', 'db/migrations/**', true],
    ['**/*.sql', 'db/schema.sql', true],
    ['**/*.sql', 'db/**', false],
    ['src/billing/**', 'src', true],
    ['src/billing/**', '**', true],
    ['src/billing/**', '*.md', true],
    ['**/package.json', 'src', false],
    ['src/auth', 'src/auth/login.ts', true],
    ['src/auth/login.ts', 'src/auth', true],
    ['src/auth', 'src/auth/**', true],
    ['s*/x', 's/**', true],
  ])('%s and %s overlap: %s', (one, other, expected) => {
    expect(patternsOverlap(one, other)).toBe(expected);
  });
});

describe('risk of a diff', () => {
  it('is low, with no signal, for a small change away from anything sensitive', () => {
    expect(assessDiff(getRisk(), getFacts())).toEqual({ level: 'low', score: 0, signals: [] });
  });

  it('is at least medium as soon as a sensitive path is touched, naming the files', () => {
    const report = assessDiff(getRisk(), getFacts({ paths: ['src/export/csv.ts', 'src/billing/rounding.ts', 'src/auth/login.ts'] }));

    expect(report).toEqual({ level: 'medium', score: 4, signals: [{ name: 'sensitive paths', points: 4, reason: 'touches src/billing/rounding.ts, src/auth/login.ts' }] });
  });

  it('names all three files when exactly three are touched', () => {
    const paths = ['src/auth/a.ts', 'src/auth/b.ts', 'src/auth/c.ts'];

    expect(assessDiff(getRisk(), getFacts({ paths })).signals[0]?.reason).toBe('touches src/auth/a.ts, src/auth/b.ts, src/auth/c.ts');
  });

  it('names only the first three files of a long list', () => {
    const paths = ['src/auth/a.ts', 'src/auth/b.ts', 'src/auth/c.ts', 'src/auth/d.ts', 'src/auth/e.ts'];

    expect(assessDiff(getRisk(), getFacts({ paths })).signals[0]?.reason).toBe('touches src/auth/a.ts, src/auth/b.ts, src/auth/c.ts and 2 more');
  });

  it('adds points for each kind of change it recognises', () => {
    const report = assessDiff(getRisk(), getFacts({ paths: ['db/migrations/0007_add_column.sql', 'package.json', '.github/workflows/ci.yml'] }));

    expect(report.signals).toEqual([
      { name: 'schema or data migration', points: 3, reason: 'touches db/migrations/0007_add_column.sql' },
      { name: 'dependency update', points: 2, reason: 'touches package.json' },
      { name: 'CI or infrastructure', points: 2, reason: 'touches .github/workflows/ci.yml' },
    ]);
    expect(report).toMatchObject({ score: 7, level: 'high' });
  });

  it('adds points for size only past the limits', () => {
    const files = (count: number) => Array.from({ length: count }, (_, index) => `src/export/file-${index}.ts`);

    expect(assessDiff(getRisk(), getFacts({ paths: files(15), lines: 400, capabilities: 1 })).signals).toEqual([]);
    expect(assessDiff(getRisk(), getFacts({ paths: files(16), lines: 401, capabilities: 2 })).signals).toEqual([
      { name: 'size', points: 2, reason: '16 files, more than 15' },
      { name: 'size', points: 2, reason: '401 lines, more than 400' },
      { name: 'size', points: 1, reason: '2 capabilities touched' },
    ]);
  });

  it('adds points when confidence is lower: more attempts, or advisory checks that failed', () => {
    expect(assessDiff(getRisk(), getFacts({ attempts: 2 })).signals).toEqual([{ name: 'confidence', points: 1, reason: '2 attempts used' }]);
    expect(assessDiff(getRisk(), getFacts({ attempts: 3 })).signals).toEqual([{ name: 'confidence', points: 2, reason: '3 attempts used' }]);
    expect(assessDiff(getRisk(), getFacts({ attempts: 5, warnings: 1 })).signals).toEqual([
      { name: 'confidence', points: 2, reason: '5 attempts used' },
      { name: 'confidence', points: 1, reason: '1 advisory check failed' },
    ]);
    expect(assessDiff(getRisk(), getFacts({ warnings: 2 })).signals).toEqual([{ name: 'confidence', points: 1, reason: '2 advisory checks failed' }]);
  });

  it('turns the score into a level at the configured thresholds', () => {
    const risk = getRisk('  thresholds: { medium: 2, high: 4 }\n  kinds:\n    - { name: one, paths: ["one/**"], points: 1 }\n    - { name: two, paths: ["two/**"], points: 2 }\n    - { name: three, paths: ["three/**"], points: 1 }\n');
    const levelFor = (...paths: string[]) => assessDiff(risk, getFacts({ paths })).level;

    expect([levelFor('one/a'), levelFor('two/a'), levelFor('one/a', 'two/a'), levelFor('one/a', 'two/a', 'three/a')]).toEqual(['low', 'medium', 'medium', 'high']);
  });
});

describe('risk predicted from a spec', () => {
  const spec = (paths: readonly string[], deltas = 1) => [
    { name: 'proposal.md', content: `# Proposal\n\n## Why\nx\n\n## Affected paths\n${paths.map((path) => `- \`${path}\``).join('\n')}\n\n## Impact\n- \`migrations/**\`\n` },
    ...Array.from({ length: deltas }, (_, index) => ({ name: `specs__cap-${index}__spec.md`, content: '# Spec Delta' })),
  ];

  it('is low for a spec whose affected paths stay away from anything sensitive', () => {
    expect(assessSpec(getRisk(), spec(['src/export/**']))).toEqual({ level: 'low', score: 0, signals: [] });
  });

  it('is at least medium when an affected path overlaps a sensitive one', () => {
    expect(assessSpec(getRisk(), spec(['src/billing/rounding.ts'])).level).toBe('medium');
    expect(assessSpec(getRisk(), spec(['src/**'])).level).toBe('medium');
  });

  it('counts the capabilities the spec touches and the kinds of change its paths announce', () => {
    const report = assessSpec(getRisk(), spec(['db/schema.sql', 'src/export/**'], 2));

    expect(report.signals.map((signal) => signal.reason)).toEqual(['touches db/schema.sql', '2 capabilities touched']);
  });

  it('has no path to judge when the spec lists none', () => {
    const report = assessSpec(getRisk(), [{ name: 'proposal.md', content: '# Proposal\n\nNo section here.\n' }]);

    expect(report).toEqual({ level: 'low', score: 0, signals: [] });
  });

  it('counts only delta spec files as capabilities', () => {
    const names = ['specs__billing__spec.md', 'specs__export__spec.md', 'old-specs__auth__spec.md', 'specs__auth__spec.md.bak', 'design.md'];

    const report = assessSpec(getRisk(), names.map((name) => ({ name, content: '# Spec Delta' })));

    expect(report.signals).toEqual([{ name: 'size', points: 1, reason: '2 capabilities touched' }]);
  });

  it.each([
    ['a list outside any affected paths section', '# Design\n\n- `src/auth/login.ts`\n'],
    ['a sentence that only mentions the section', '# Design\n\nSee the ## Affected paths section\n- `src/auth/login.ts`\n'],
    ['a sentence with a dash in it', '## Affected paths\nNothing sensitive - src/auth/login.ts stays as is\n'],
    ['a path listed in the next section', '## Affected paths\n- `src/export/**`\n# Notes\n- `src/auth/login.ts`\n'],
  ])('does not read a path from %s', (_case, content) => {
    expect(assessSpec(getRisk(), [{ name: 'design.md', content }]).level).toBe('low');
  });

  it.each([
    ['right under the title', '# Design\n## Affected paths\n- `src/auth/login.ts`\n'],
    ['indented', '## Affected paths\n  - `src/auth/login.ts`\n'],
    ['after two spaces', '## Affected paths\n-  src/auth/login.ts\n'],
    ['followed by a note that mentions C# code', '## Affected paths\n- `src/export/**`\n- `src/auth/login.ts` (the C# service)\n'],
  ])('reads a path listed %s', (_case, content) => {
    expect(assessSpec(getRisk(), [{ name: 'design.md', content }]).level).toBe('medium');
  });

  it('reads paths up to the end of the file when the section is the last one', () => {
    const report = assessSpec(getRisk(), [{ name: 'design.md', content: '# Design\n\n### Affected paths\n* src/auth/login.ts' }]);

    expect(report.level).toBe('medium');
  });
});

describe('final risk', () => {
  it.each([
    ['low', 'low', 'low'],
    ['low', 'medium', 'medium'],
    ['high', 'medium', 'high'],
    ['medium', 'high', 'high'],
  ] as const)('the higher of %s and %s is %s', (one, other, expected) => {
    expect(higherRisk(one, other)).toBe(expected);
  });

  it('lets a reviewer raise the level with a written reason, and never lower it', () => {
    expect(raisedRisk('low', { to: 'high', reason: 'Touches the payment retry path indirectly' })).toBe('high');
    expect(raisedRisk('medium', { to: 'low', reason: 'It is a small change' })).toBe('medium');
    expect(raisedRisk('low', { to: 'high', reason: '   ' })).toBe('low');
    expect(raisedRisk('medium', undefined)).toBe('medium');
  });
});

describe('merge route', () => {
  const open = { noAutomergeLabel: false, suspended: false };

  it('keeps a person merging while the level is in shadow mode, noting it would have auto-merged', () => {
    expect(decideMerge(getRisk(), 'low', open)).toEqual({ route: 'human', wouldAutoMerge: true, reason: 'low risk is in shadow mode' });
  });

  it('merges automatically once shadow mode is off, for the whole project or for that level', () => {
    const auto = { route: 'auto', wouldAutoMerge: true, reason: 'low risk merges automatically' };

    expect(decideMerge(getRisk('  shadow: false\n'), 'low', open)).toEqual(auto);
    expect(decideMerge(getRisk('', '{ merge: auto, shadow: false }'), 'low', open)).toEqual(auto);
    expect(decideMerge(getRisk('  shadow: false\n', '{ merge: auto, shadow: true }'), 'low', open).route).toBe('human');
  });

  it('always leaves medium and high risk to a person', () => {
    expect(decideMerge(getRisk('  shadow: false\n'), 'medium', open)).toEqual({ route: 'human', wouldAutoMerge: false, reason: 'medium risk is merged by a person' });
    expect(decideMerge(getRisk('  shadow: false\n'), 'high', open)).toMatchObject({ route: 'human', wouldAutoMerge: false });
  });

  it('lets a ceiling set at approval or the no-automerge label override the policy for one ticket', () => {
    const risk = getRisk('  shadow: false\n');

    expect(decideMerge(risk, 'low', { ...open, ceiling: 'human' })).toEqual({ route: 'human', wouldAutoMerge: false, reason: 'a human merge was required at approval' });
    expect(decideMerge(risk, 'low', { ...open, noAutomergeLabel: true })).toEqual({ route: 'human', wouldAutoMerge: false, reason: 'the ticket carries the no-automerge label' });
  });

  it('puts a level back in shadow mode after a revert, whatever the config says', () => {
    expect(decideMerge(getRisk('  shadow: false\n'), 'low', { ...open, suspended: true })).toEqual({
      route: 'human',
      wouldAutoMerge: true,
      reason: 'auto-merge for low risk is back in shadow mode after a revert',
    });
  });
});
