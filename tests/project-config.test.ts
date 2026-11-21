import { describe, expect, it } from 'vitest';
import { parseAdaptersConfig, parseFactoryConfig } from '../src/config/project-config.js';

const sampleFactoryYaml = (extra = ''): string => `
schema: 1
engine: 0.1.0
states:
  to_refine: To refine
  spec_review: Spec review
  ready_for_dev: Ready for Dev
  in_development: Doing
  in_review: In review
  blocked: Blocked
  done: Done
labels:
  auto: factory-auto
  no_automerge: "factory:no-automerge"
checks:
  - id: unit-tests
    station: quality
    kind: script
    source: local
    blocking: true
    timeout: 6m
    run: pnpm test
  - id: ui-design-conformance
    station: review
    kind: agent
    blocking: true
    applies_when: "changed: src/ui/**"
    timeout: 10m
    criteria: .factory/checks/ui-design.md
    evidence: screenshots of changed screens
risk:
  low:    { merge: auto, require: [all_gates, ci_green] }
  medium: { merge: human, reviewers: 1 }
  high:   { merge: human, reviewers: 2, extra_checks: [security-review] }
  sensitive_paths: [src/auth/**, src/billing/**, migrations/**]
  shadow: true
${extra}`;

const sampleAdaptersYaml = (extra = ''): string => `
repository: acme/billing-service
ticket_providers:
  - kind: jira
    base_url: https://acme.atlassian.net
    filter: project = PAY AND component = billing-service
    token_env: JIRA_TOKEN
    email_env: JIRA_EMAIL
${extra}source_control:
  kind: github
  repo: acme/billing-service
agent_runtime:
  kind: orca
`;

const issuesOf = (result: ReturnType<typeof parseFactoryConfig> | ReturnType<typeof parseAdaptersConfig>) =>
  result.ok ? [] : result.issues;

describe('factory.yaml', () => {
  it('accepts the design doc sample and maps a factory state to the project status name', () => {
    const result = parseFactoryConfig(sampleFactoryYaml());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.states.in_development).toBe('Doing');
    expect(result.value.engine).toBe('0.1.0');
    expect(result.value.checks.map((check) => check.id)).toEqual(['unit-tests', 'ui-design-conformance']);
    expect(result.value.risk.low.merge).toBe('auto');
    expect(result.value.risk.shadow).toBe(true);
  });

  it('defaults to 5 attempts per run, 3 runs per ticket and a threshold of 20 when limits are omitted', () => {
    const result = parseFactoryConfig(sampleFactoryYaml());

    expect(result.ok && result.value.limits).toEqual({ attempts: 5, runs: 3 });
    expect(result.ok && result.value.risk.shadow_threshold).toBe(20);
  });

  it('builds from main unless the project names another main branch', () => {
    const named = parseFactoryConfig(sampleFactoryYaml('main_branch: develop'));

    expect((() => { const r = parseFactoryConfig(sampleFactoryYaml()); return r.ok && r.value.main_branch; })()).toBe('main');
    expect(named.ok && named.value.main_branch).toBe('develop');
  });

  it('lets a project set its own limits', () => {
    const result = parseFactoryConfig(sampleFactoryYaml('limits: { attempts: 4, runs: 2 }'));

    expect(result.ok && result.value.limits).toEqual({ attempts: 4, runs: 2 });
  });

  it('defaults a check to local source and no path scope', () => {
    const result = parseFactoryConfig(sampleFactoryYaml());

    expect(result.ok && result.value.checks[1]?.source).toBe('local');
    expect(result.ok && result.value.checks[0]?.applies_when).toBeUndefined();
  });

  it.each([
    ['attempts: 0', 'limits.attempts'],
    ['runs: 0', 'limits.runs'],
  ])('rejects a limit below 1 (%s)', (limit, path) => {
    const result = parseFactoryConfig(sampleFactoryYaml(`limits: { ${limit} }`));

    expect(issuesOf(result).map((issue) => issue.path)).toEqual([path]);
  });

  it('accepts a limit of exactly 1', () => {
    const result = parseFactoryConfig(sampleFactoryYaml('limits: { attempts: 1, runs: 1 }'));

    expect(result.ok && result.value.limits).toEqual({ attempts: 1, runs: 1 });
  });

  it('rejects a config that leaves a factory state unmapped', () => {
    const result = parseFactoryConfig(sampleFactoryYaml().replace('  blocked: Blocked\n', ''));

    expect(issuesOf(result).map((issue) => issue.path)).toEqual(['states.blocked']);
  });

  it('rejects an agent check with no criteria or evidence, naming both fields', () => {
    const yaml = sampleFactoryYaml()
      .replace('    criteria: .factory/checks/ui-design.md\n', '')
      .replace('    evidence: screenshots of changed screens\n', '');

    const result = parseFactoryConfig(yaml);

    expect(issuesOf(result).map((issue) => issue.path)).toEqual(['checks.1.criteria', 'checks.1.evidence']);
  });

  it('rejects a check whose kind is neither script nor agent', () => {
    const result = parseFactoryConfig(sampleFactoryYaml().replace('kind: script', 'kind: manual'));

    expect(issuesOf(result).map((issue) => issue.path)).toEqual(['checks.0.kind']);
  });

  it('rejects two checks with the same id', () => {
    const result = parseFactoryConfig(sampleFactoryYaml().replace('id: ui-design-conformance', 'id: unit-tests'));

    expect(issuesOf(result)).toEqual([{ path: 'checks.1.id', message: 'Duplicate check id "unit-tests"' }]);
  });

  it('accepts a check whose result is read from CI', () => {
    const result = parseFactoryConfig(sampleFactoryYaml().replace('source: local', 'source: ci'));

    expect(result.ok && result.value.checks[0]?.source).toBe('ci');
  });

  it('rejects a config with no auto label', () => {
    const result = parseFactoryConfig(sampleFactoryYaml().replace('  auto: factory-auto\n', ''));

    expect(issuesOf(result).map((issue) => issue.path)).toEqual(['labels.auto']);
  });

  it('rejects a config with no no-automerge label', () => {
    const result = parseFactoryConfig(sampleFactoryYaml().replace('  no_automerge: "factory:no-automerge"\n', ''));

    expect(issuesOf(result).map((issue) => issue.path)).toEqual(['labels.no_automerge']);
  });

  it('starts in shadow mode when the config does not say', () => {
    const result = parseFactoryConfig(sampleFactoryYaml().replace('  shadow: true\n', ''));

    expect(result.ok && result.value.risk.shadow).toBe(true);
  });

  it('lets a project turn shadow mode off and set its own threshold', () => {
    const result = parseFactoryConfig(sampleFactoryYaml().replace('  shadow: true\n', '  shadow: false\n  shadow_threshold: 30\n'));

    expect(result.ok && result.value.risk.shadow).toBe(false);
    expect(result.ok && result.value.risk.shadow_threshold).toBe(30);
  });

  it('rejects a shadow threshold below 1', () => {
    const result = parseFactoryConfig(sampleFactoryYaml().replace('  shadow: true\n', '  shadow_threshold: 0\n'));

    expect(issuesOf(result).map((issue) => issue.path)).toEqual(['risk.shadow_threshold']);
  });

  it('rejects an unsupported schema version', () => {
    const result = parseFactoryConfig(sampleFactoryYaml().replace('schema: 1', 'schema: 2'));

    expect(issuesOf(result).map((issue) => issue.path)).toEqual(['schema']);
  });

  it('reports text that is not valid YAML', () => {
    const result = parseFactoryConfig('states: [unclosed');

    expect(result.ok).toBe(false);
    expect(issuesOf(result)[0]?.path).toBe('');
  });
});

describe('adapters.yaml', () => {
  it('accepts connections that name an environment variable instead of holding a token', () => {
    const result = parseAdaptersConfig(sampleAdaptersYaml());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.repository).toBe('acme/billing-service');
    expect(result.value.ticket_providers[0]?.token_env).toBe('JIRA_TOKEN');
    expect(result.value.ticket_providers[0]?.email_env).toBe('JIRA_EMAIL');
    expect(result.value.source_control.kind).toBe('github');
  });

  it('rejects a config containing a token and names the field', () => {
    const result = parseAdaptersConfig(sampleAdaptersYaml('    token: abc123\n'));

    expect(issuesOf(result)).toEqual([
      { path: 'ticket_providers.0.token', message: 'Secrets must not be stored in adapters.yaml' },
    ]);
  });

  it.each(['ghp_16C7e42F292c6912E7710c838347Ae178B4a', 'ATATT3xFfGF0abc', 'xoxb-123-456-abc', 'lin_api_4f9a'])(
    'rejects a token-like value under an innocent field name (%s)',
    (value) => {
      const result = parseAdaptersConfig(sampleAdaptersYaml().replace('JIRA_TOKEN', value));

      expect(issuesOf(result).map((issue) => issue.path)).toEqual(['ticket_providers.0.token_env']);
    },
  );

  it.each(['password', 'api_key', 'client_secret'])('rejects a field named %s', (field) => {
    const result = parseAdaptersConfig(sampleAdaptersYaml(`    ${field}: hunter2\n`));

    expect(issuesOf(result).map((issue) => issue.path)).toEqual([`ticket_providers.0.${field}`]);
  });

  it.each(['linear', 'github-issues'])('accepts a %s ticket provider', (kind) => {
    const result = parseAdaptersConfig(sampleAdaptersYaml().replace('kind: jira', `kind: ${kind}`));

    expect(result.ok && result.value.ticket_providers[0]?.kind).toBe(kind);
  });

  it('accepts Bitbucket as source control', () => {
    const result = parseAdaptersConfig(sampleAdaptersYaml().replace('kind: github', 'kind: bitbucket'));

    expect(result.ok && result.value.source_control.kind).toBe('bitbucket');
  });

  it('rejects an agent runtime other than Orca', () => {
    const result = parseAdaptersConfig(sampleAdaptersYaml().replace('kind: orca', 'kind: other'));

    expect(issuesOf(result).map((issue) => issue.path)).toEqual(['agent_runtime.kind']);
  });

  it('rejects a field named apikey with no separator', () => {
    const result = parseAdaptersConfig(sampleAdaptersYaml('    apikey: hunter2\n'));

    expect(issuesOf(result).map((issue) => issue.path)).toEqual(['ticket_providers.0.apikey']);
  });

  it('accepts a value that merely contains a token prefix further in', () => {
    const result = parseAdaptersConfig(sampleAdaptersYaml().replace('component = billing-service', 'label = team-xoxb-alpha'));

    expect(result.ok).toBe(true);
  });

  it('reports an empty field as invalid instead of failing on it', () => {
    const result = parseAdaptersConfig(sampleAdaptersYaml('    base_url:\n').replace('    base_url: https://acme.atlassian.net\n', ''));

    expect(issuesOf(result).map((issue) => issue.path)).toEqual(['ticket_providers.0.base_url']);
  });

  it('reports adapters text that is not valid YAML', () => {
    const result = parseAdaptersConfig('ticket_providers: [unclosed');

    expect(result.ok).toBe(false);
    expect(issuesOf(result)[0]?.path).toBe('');
  });

  it('rejects a config with no ticket provider', () => {
    const yaml = 'repository: a/b\nticket_providers: []\nsource_control: { kind: github, repo: a/b }\nagent_runtime: { kind: orca }\n';

    const result = parseAdaptersConfig(yaml);

    expect(issuesOf(result).map((issue) => issue.path)).toEqual(['ticket_providers']);
  });
});
