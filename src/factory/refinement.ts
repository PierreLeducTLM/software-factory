import { createHash } from 'node:crypto';
import type { Ticket } from '../adapters/ticket-provider.js';
import type { FactoryConfig } from '../config/project-config.js';
import { loadRecord, saveRecord } from '../record/record-store.js';
import {
  createRecord,
  endRun,
  recordApproval,
  recordReadyGate,
  recordSendBack,
  setState,
  type SendBackQuestion,
  type TicketRecord,
} from '../record/ticket-record.js';
import { matchesPath } from './paths.js';
import type { FactoryDeps } from './run-lifecycle.js';

export type SpecFile = { readonly name: string; readonly content: string };

export type Risk = 'low' | 'medium' | 'high';

export type RefinementDeps = FactoryDeps & {
  readonly validateSpec: (files: readonly SpecFile[]) => Promise<readonly string[]>;
  readonly predictRisk: (files: readonly SpecFile[]) => Promise<Risk>;
  readonly mainCommit: () => Promise<string>;
  readonly changedFilesSince: (commit: string) => Promise<readonly string[]>;
};

type Refusal = 'not_found' | 'no_spec' | 'record_edited' | 'not_ready' | 'not_in_spec_review' | 'no_run';

type Refused = { readonly ok: false; readonly reason: Refusal; readonly message: string };

export type PullResult = { readonly ok: true; readonly files: readonly SpecFile[] } | Refused;
export type PushResult = { readonly ok: true; readonly attached: readonly string[] } | Refused;

export type StatusResult =
  | {
      readonly ok: true;
      readonly status: string;
      readonly gate?: { readonly passed: boolean; readonly findings: readonly string[]; readonly current: boolean };
      readonly approval?: { readonly approver: string; readonly at: string; readonly predictedRisk: Risk };
      readonly questions: readonly SendBackQuestion[];
    }
  | Refused
  | (Refused & { readonly ticket: { readonly title: string; readonly description: string } });

export type GateResult = { readonly ok: true; readonly passed: boolean; readonly findings: readonly string[] } | Refused;
export type ApprovalResult = { readonly ok: true; readonly risk: Risk; readonly route: string } | Refused;

const FACTORY_PREFIX = 'factory-';
const DELTA_SPEC = /^specs__(.+)__spec\.md$/;
const TASK_LINE = /^\s*- \[[ xX]\] /;
const SAYS_HOW_VERIFIED = /\bverif(y|ies|ied)\b/i;
const TBD = /\bTBD\b/;
const LIST_ITEM = /^\s*[-*]\s+`?([^`\s]+)`?/;
const NOTHING_OPEN = /^none\.?$/i;

const refuse = (reason: Refusal, message: string): Refused => ({ ok: false, reason, message });

const loadSpecFiles = async (deps: RefinementDeps, key: string): Promise<readonly SpecFile[]> => {
  const markdown = (await deps.tickets.listAttachments(key)).filter(({ name }) => name.endsWith('.md') && !name.startsWith(FACTORY_PREFIX));
  const newest = markdown.filter((attachment, index) => markdown.findLastIndex((other) => other.name === attachment.name) === index);
  const files = await Promise.all(newest.map(async ({ name, link }) => ({ name, content: await deps.tickets.readAttachment(link) })));
  return files.toSorted((a, b) => a.name.localeCompare(b.name));
};

const fingerprintOf = (files: readonly SpecFile[]): string =>
  createHash('sha256').update(JSON.stringify(files.map(({ name, content }) => [name, content]))).digest('hex');

const sectionOf = (content: string, title: RegExp): readonly string[] | undefined => {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => title.test(line));
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3} /.test(line));
  return end === -1 ? rest : rest.slice(0, end);
};

const affectedPathsOf = (files: readonly SpecFile[]): readonly string[] =>
  files.flatMap((file) => sectionOf(file.content, /^#{2,3} Affected paths\b/i) ?? []).flatMap((line) => LIST_ITEM.exec(line)?.[1] ?? []);

const structuralFindings = (files: readonly SpecFile[]): readonly string[] => {
  const named = (name: string): SpecFile | undefined => files.find((file) => file.name === name);
  const design = named('design.md');
  const tasks = named('tasks.md');
  const taskLines = (tasks?.content.split('\n') ?? []).map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => TASK_LINE.test(line));
  const openQuestions = (design === undefined ? undefined : sectionOf(design.content, /^## Open Questions\b/i)) ?? [];

  return [
    ...['proposal.md', 'design.md', 'tasks.md'].filter((name) => named(name) === undefined).map((name) => `${name} is not attached`),
    ...(files.some((file) => DELTA_SPEC.test(file.name)) ? [] : ['No delta spec is attached (specs__<capability>__spec.md)']),
    ...files.flatMap((file) =>
      file.content.split('\n').flatMap((line, index) => (TBD.test(line) ? [`${file.name}:${index + 1} contains a TBD marker`] : [])),
    ),
    ...(design !== undefined && sectionOf(design.content, /^## Decisions\b/i) === undefined ? ['design.md has no Decisions section'] : []),
    ...(affectedPathsOf(files).length === 0 ? ['No Affected paths section lists a path'] : []),
    ...(openQuestions.some((line) => line.trim() !== '' && !NOTHING_OPEN.test(line.trim())) ? ['design.md still has open questions'] : []),
    ...(tasks !== undefined && taskLines.length === 0 ? ['tasks.md has no tasks'] : []),
    ...taskLines.filter(({ line }) => !SAYS_HOW_VERIFIED.test(line)).map(({ number }) => `tasks.md:${number} does not say how it is verified`),
  ];
};

type Gate = { readonly passed: boolean; readonly fingerprint: string; readonly findings: readonly string[] };

const checkReadiness = async (deps: RefinementDeps, files: readonly SpecFile[]): Promise<Gate> => {
  const findings = [...structuralFindings(files), ...(await deps.validateSpec(files))];
  return { passed: findings.length === 0, fingerprint: fingerprintOf(files), findings };
};

type Opened =
  | { readonly ok: true; readonly ticket: Ticket; readonly files: readonly SpecFile[]; readonly record: TicketRecord }
  | { readonly ok: false; readonly refusal: Refused; readonly ticket?: Ticket };

const open = async (deps: RefinementDeps, key: string): Promise<Opened> => {
  const ticket = await deps.tickets.getTicket(key);
  if (ticket === undefined) return { ok: false, refusal: refuse('not_found', `${key} does not exist`) };
  const files = await loadSpecFiles(deps, key);
  if (files.length === 0) return { ok: false, refusal: refuse('no_spec', `${key} has no OpenSpec files attached. A draft spec is required`), ticket };
  const loaded = await loadRecord(deps.tickets, key);
  if (loaded.status === 'edited' || loaded.status === 'invalid') {
    return { ok: false, refusal: refuse('record_edited', `The record on ${key} was edited outside the factory`) };
  }
  return { ok: true, ticket, files, record: loaded.status === 'ok' ? loaded.record : createRecord({ repository: ticket.repository }) };
};

const save = (deps: RefinementDeps, key: string, record: TicketRecord, summary: string): Promise<void> =>
  saveRecord(deps.tickets, { key, record, summary, budget: deps.recordBudget });

const withGate = (deps: RefinementDeps, record: TicketRecord, gate: Gate): TicketRecord =>
  recordReadyGate(record, { ...gate, at: deps.now(), by: deps.user });

const routeFor = (config: FactoryConfig, risk: Risk, ceiling?: 'human'): string => {
  const label = `${risk.charAt(0).toUpperCase()}${risk.slice(1)} risk`;
  if (ceiling === 'human' || config.risk[risk].merge === 'human') return `${label}, merged by a person`;
  return `${label}, ${config.risk.shadow ? 'would' : 'will'} auto-merge`;
};

export const pullSpecFiles = async (deps: RefinementDeps, key: string): Promise<PullResult> => {
  const opened = await open(deps, key);
  return opened.ok ? { ok: true, files: opened.files } : opened.refusal;
};

export const pushSpecFiles = async (deps: RefinementDeps, key: string, files: readonly SpecFile[]): Promise<PushResult> => {
  if ((await deps.tickets.getTicket(key)) === undefined) return refuse('not_found', `${key} does not exist`);
  const notSpec = files.find((file) => !file.name.endsWith('.md') || file.name.startsWith(FACTORY_PREFIX));
  if (notSpec !== undefined) return refuse('no_spec', `${notSpec.name} is not a spec file. Spec files end in .md and do not start with ${FACTORY_PREFIX}`);
  const attached = await loadSpecFiles(deps, key);
  const changed = files.filter((file) => attached.find((existing) => existing.name === file.name)?.content !== file.content);
  await changed.reduce(async (previous, { name, content }) => {
    await previous;
    await deps.tickets.addAttachment({ key, name, content });
  }, Promise.resolve());
  return { ok: true, attached: changed.map((file) => file.name) };
};

export const refinementStatus = async (deps: RefinementDeps, key: string): Promise<StatusResult> => {
  const opened = await open(deps, key);
  if (!opened.ok) {
    return opened.ticket === undefined
      ? opened.refusal
      : { ...opened.refusal, ticket: { title: opened.ticket.title, description: opened.ticket.spec ?? '' } };
  }
  const { readyGate, approval, sendBack } = opened.record.refinement;
  return {
    ok: true,
    status: opened.ticket.status,
    ...(readyGate === undefined
      ? {}
      : { gate: { passed: readyGate.passed, findings: readyGate.findings, current: readyGate.fingerprint === fingerprintOf(opened.files) } }),
    ...(approval === undefined ? {} : { approval: { approver: approval.approver, at: approval.at, predictedRisk: approval.predictedRisk } }),
    questions: sendBack?.questions ?? [],
  };
};

export const startRefinement = async (deps: RefinementDeps, key: string): Promise<{ readonly ok: true } | Refused> => {
  const opened = await open(deps, key);
  if (!opened.ok) return opened.refusal;
  const { to_refine: from, spec_review: to } = deps.config.states;
  if (opened.ticket.status === from) await deps.tickets.transition({ key, from, to });
  const record = opened.record.state === 'spec_review' ? opened.record : setState(opened.record, { state: 'spec_review', at: deps.now(), by: deps.user });
  await save(deps, key, record, 'Refinement started');
  return { ok: true };
};

export const runReadyGate = async (deps: RefinementDeps, key: string): Promise<GateResult> => {
  const opened = await open(deps, key);
  if (!opened.ok) return opened.refusal;
  const gate = await checkReadiness(deps, opened.files);
  await save(deps, key, withGate(deps, opened.record, gate), `Ready gate ${gate.passed ? 'passed' : 'failed'}`);
  return { ok: true, passed: gate.passed, findings: gate.findings };
};

export const approvalPreview = async (deps: RefinementDeps, key: string): Promise<ApprovalResult> => {
  const opened = await open(deps, key);
  if (!opened.ok) return opened.refusal;
  const risk = await deps.predictRisk(opened.files);
  return { ok: true, risk, route: routeFor(deps.config, risk) };
};

export const approve = async (deps: RefinementDeps, key: string, options: { readonly mergeCeiling?: 'human' } = {}): Promise<ApprovalResult> => {
  const opened = await open(deps, key);
  if (!opened.ok) return opened.refusal;
  const { spec_review: from, ready_for_dev: to } = deps.config.states;
  if (opened.ticket.status !== from) return refuse('not_in_spec_review', `${key} is in "${opened.ticket.status}", not "${from}"`);

  const fingerprint = fingerprintOf(opened.files);
  const last = opened.record.refinement.readyGate;
  const current = last !== undefined && last.passed && last.fingerprint === fingerprint;
  const gate = current ? last : await checkReadiness(deps, opened.files);
  const gated = current ? opened.record : withGate(deps, opened.record, gate);
  if (!gate.passed) {
    await save(deps, key, gated, 'Ready gate failed');
    return refuse('not_ready', `The ready gate fails: ${gate.findings.join('; ')}`);
  }

  const risk = await deps.predictRisk(opened.files);
  const at = deps.now();
  const stamped = recordApproval(gated, {
    approver: deps.user,
    at,
    mainCommit: await deps.mainCommit(),
    fingerprint,
    predictedRisk: risk,
    ...(options.mergeCeiling === undefined ? {} : { mergeCeiling: options.mergeCeiling }),
  });
  const route = routeFor(deps.config, risk, options.mergeCeiling);
  await deps.tickets.transition({ key, from, to });
  await save(deps, key, setState(stamped, { state: 'ready_for_dev', at, by: deps.user }), `Approved by ${deps.user} · ${route}`);
  return { ok: true, risk, route };
};

const EDITED_AFTER_APPROVAL: SendBackQuestion = {
  question: 'The spec was edited after it was approved. Should the edited spec be built?',
  recommended: 'Run the ready gate and approve the edited spec.',
};

export const revalidate = async (deps: RefinementDeps, key: string): Promise<GateResult> => {
  const opened = await open(deps, key);
  if (!opened.ok) return opened.refusal;
  const approval = opened.record.refinement.approval;
  if (approval === undefined || opened.record.runs.at(-1)?.status !== 'running') return refuse('no_run', `${key} has no run in progress`);

  const edited = fingerprintOf(opened.files) !== approval.fingerprint;
  const watched = [
    ...affectedPathsOf(opened.files),
    ...opened.files.flatMap((file) => DELTA_SPEC.exec(file.name)?.[1] ?? []).map((capability) => `openspec/specs/${capability.replaceAll('__', '/')}/**`),
  ];
  const drifted = edited ? [] : (await deps.changedFilesSince(approval.mainCommit)).filter((file) => watched.some((pattern) => matchesPath(pattern, file)));
  if (!edited && drifted.length === 0) return { ok: true, passed: true, findings: [] };

  const list = drifted.join(', ');
  const finding = edited ? 'The approved spec changed after approval' : `Changed on main since approval: ${list}`;
  const question: SendBackQuestion = edited
    ? EDITED_AFTER_APPROVAL
    : {
        question: `These files changed on main after the spec was approved: ${list}. Does the spec still hold?`,
        recommended: 'Review the changes, update the spec if needed, and approve again.',
      };

  const at = deps.now();
  const by = deps.user;
  const record = setState(endRun(recordSendBack(opened.record, { questions: [question], at, by }), { status: 'sent_back', at, by }), {
    state: 'spec_review',
    at,
    by,
  });
  await deps.tickets.transition({ key, from: deps.config.states.in_development, to: deps.config.states.spec_review });
  await save(deps, key, record, 'Sent back to refinement');
  return { ok: true, passed: false, findings: [finding] };
};
