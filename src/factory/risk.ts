import type { FactoryConfig } from '../config/project-config.js';
import { matchesPath, patternsOverlap } from './paths.js';

export type RiskLevel = 'low' | 'medium' | 'high';

export type RiskFacts = {
  readonly paths: readonly string[];
  readonly lines: number;
  readonly capabilities: number;
  readonly attempts: number;
  readonly warnings: number;
};

export type RiskSignal = { readonly name: string; readonly points: number; readonly reason: string };

export type RiskReport = { readonly level: RiskLevel; readonly score: number; readonly signals: readonly RiskSignal[] };

export type RiskRaise = { readonly to: RiskLevel; readonly reason: string };

export type MergeDecision = { readonly route: 'auto' | 'human'; readonly wouldAutoMerge: boolean; readonly reason: string };

type RiskConfig = FactoryConfig['risk'];

const LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high'];
const SENSITIVE_POINTS = 4;
const LISTED = 3;

const DELTA_SPEC = /^specs__(.+)__spec\.md$/;
const AFFECTED_HEADING = /^#{2,3} Affected paths\b/i;
const LIST_ITEM = /^\s*[-*]\s+`?([^`\s]+)`?/;

const some = (items: readonly string[]): string => (items.length <= LISTED ? items.join(', ') : `${items.slice(0, LISTED).join(', ')} and ${items.length - LISTED} more`);

export const higherRisk = (one: RiskLevel, other: RiskLevel): RiskLevel => (LEVELS.indexOf(one) >= LEVELS.indexOf(other) ? one : other);

type Touches = (pattern: string, path: string) => boolean;

const assess = (risk: RiskConfig, facts: RiskFacts, touches: Touches, extra: readonly RiskSignal[] = []): RiskReport => {
  const touching = (patterns: readonly string[]): readonly string[] => facts.paths.filter((path) => patterns.some((pattern) => touches(pattern, path)));
  const sensitive = touching(risk.sensitive_paths);
  const signals: readonly RiskSignal[] = [
    ...(sensitive.length === 0 ? [] : [{ name: 'sensitive paths', points: SENSITIVE_POINTS, reason: `touches ${some(sensitive)}` }]),
    ...risk.kinds.flatMap((kind) => {
      const touched = touching(kind.paths);
      return touched.length === 0 ? [] : [{ name: kind.name, points: kind.points, reason: `touches ${some(touched)}` }];
    }),
    ...(facts.paths.length > risk.size.files ? [{ name: 'size', points: 2, reason: `${facts.paths.length} files, more than ${risk.size.files}` }] : []),
    ...(facts.lines > risk.size.lines ? [{ name: 'size', points: 2, reason: `${facts.lines} lines, more than ${risk.size.lines}` }] : []),
    ...(facts.capabilities > 1 ? [{ name: 'size', points: 1, reason: `${facts.capabilities} capabilities touched` }] : []),
    ...(facts.attempts >= 3 ? [{ name: 'confidence', points: 2, reason: `${facts.attempts} attempts used` }] : []),
    ...(facts.attempts === 2 ? [{ name: 'confidence', points: 1, reason: '2 attempts used' }] : []),
    ...(facts.warnings > 0 ? [{ name: 'confidence', points: 1, reason: `${facts.warnings} advisory ${facts.warnings === 1 ? 'check' : 'checks'} failed` }] : []),
    ...extra,
  ];
  const score = Math.max(0, signals.reduce((total, signal) => total + signal.points, 0));
  const level = score >= risk.thresholds.high ? 'high' : score >= risk.thresholds.medium ? 'medium' : 'low';
  return { level, score, signals };
};

export const assessDiff = (risk: RiskConfig, facts: RiskFacts, extra: readonly RiskSignal[] = []): RiskReport => assess(risk, facts, matchesPath, extra);

export const capabilitiesIn = (names: readonly string[]): number => names.filter((name) => DELTA_SPEC.test(name)).length;

type SpecFile = { readonly name: string; readonly content: string };

const affectedPathsOf = (files: readonly SpecFile[]): readonly string[] =>
  files.flatMap((file) => {
    const lines = file.content.split('\n');
    const start = lines.findIndex((line) => AFFECTED_HEADING.test(line));
    if (start === -1) return [];
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{1,3} /.test(line));
    return (end === -1 ? rest : rest.slice(0, end)).flatMap((line) => LIST_ITEM.exec(line)?.[1] ?? []);
  });

export const assessSpec = (risk: RiskConfig, files: readonly SpecFile[]): RiskReport =>
  assess(risk, { paths: affectedPathsOf(files), lines: 0, capabilities: capabilitiesIn(files.map((file) => file.name)), attempts: 1, warnings: 0 }, patternsOverlap);

export const raisedRisk = (level: RiskLevel, raise: RiskRaise | undefined): RiskLevel =>
  raise === undefined || raise.reason.trim() === '' ? level : higherRisk(level, raise.to);

type MergeContext = { readonly ceiling?: 'human'; readonly noAutomergeLabel: boolean; readonly suspended: boolean };

export const decideMerge = (risk: RiskConfig, level: RiskLevel, { ceiling, noAutomergeLabel, suspended }: MergeContext): MergeDecision => {
  const policy = risk[level];
  if (policy.merge === 'human') return { route: 'human', wouldAutoMerge: false, reason: `${level} risk is merged by a person` };
  if (ceiling === 'human') return { route: 'human', wouldAutoMerge: false, reason: 'a human merge was required at approval' };
  if (noAutomergeLabel) return { route: 'human', wouldAutoMerge: false, reason: 'the ticket carries the no-automerge label' };
  if (suspended) return { route: 'human', wouldAutoMerge: true, reason: `auto-merge for ${level} risk is back in shadow mode after a revert` };
  if (policy.shadow ?? risk.shadow) return { route: 'human', wouldAutoMerge: true, reason: `${level} risk is in shadow mode` };
  return { route: 'auto', wouldAutoMerge: true, reason: `${level} risk merges automatically` };
};
