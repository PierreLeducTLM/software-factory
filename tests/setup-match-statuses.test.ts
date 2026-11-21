import { describe, expect, it } from 'vitest';
import type { ProviderStatus } from '../src/adapters/ticket-provider.js';
import { matchStatuses } from '../src/setup/match-statuses.js';

const status = (name: string, category: ProviderStatus['category'] = 'unknown'): ProviderStatus => ({ name, category });

describe('matching provider statuses to factory states', () => {
  it('matches every state by name, so there is nothing to ask', () => {
    const statuses = ['To Refine', 'Spec review', 'Ready for Dev', 'In Development', 'In Review', 'Blocked', 'Done'].map((name) => status(name));

    expect(matchStatuses(statuses)).toEqual({
      matched: { to_refine: 'To Refine', spec_review: 'Spec review', ready_for_dev: 'Ready for Dev', in_development: 'In Development', in_review: 'In Review', blocked: 'Blocked', done: 'Done' },
      unmatched: [],
    });
  });

  it('matches common names of a stock workflow, ignoring case and punctuation', () => {
    const statuses = [status('Backlog'), status('Selected for Development'), status('IN-PROGRESS'), status('Code_Review'), status('On hold'), status('Closed')];

    expect(matchStatuses(statuses)).toEqual({
      matched: { to_refine: 'Backlog', ready_for_dev: 'Selected for Development', in_development: 'IN-PROGRESS', in_review: 'Code_Review', blocked: 'On hold', done: 'Closed' },
      unmatched: ['spec_review'],
    });
  });

  it('prefers the closest name, and gives each status to one state only', () => {
    const both = matchStatuses([status('To Do'), status('Backlog'), status('Review'), status('In Review')]);
    const alone = matchStatuses([status('To Do')]);

    expect(both.matched).toEqual({ to_refine: 'Backlog', ready_for_dev: 'To Do', in_review: 'In Review' });
    expect(alone).toEqual({ matched: { to_refine: 'To Do' }, unmatched: ['spec_review', 'ready_for_dev', 'in_development', 'in_review', 'blocked', 'done'] });
  });

  it('falls back to the status category for "in development" and "done" when exactly one status is left in it', () => {
    const result = matchStatuses([status('Building', 'in_progress'), status('Shipped', 'done'), status('Idea', 'todo')]);

    expect(result.matched).toEqual({ in_development: 'Building', done: 'Shipped' });
    expect(result.unmatched).toEqual(['to_refine', 'spec_review', 'ready_for_dev', 'in_review', 'blocked']);
  });

  it('does not guess from the category when several statuses share it, or when the name already matched', () => {
    const several = matchStatuses([status('Building', 'in_progress'), status('Testing', 'in_progress'), status('Shipped', 'done'), status('Archived', 'done')]);
    const named = matchStatuses([status('In progress', 'in_progress'), status('Review', 'in_progress'), status('QA', 'in_progress'), status('Done', 'done'), status('Shipped', 'done')]);

    expect(several.matched).toEqual({});
    expect(named.matched).toEqual({ in_development: 'In progress', in_review: 'Review', done: 'Done' });
  });

  it('asks about every state when the provider has no status', () => {
    expect(matchStatuses([])).toEqual({ matched: {}, unmatched: ['to_refine', 'spec_review', 'ready_for_dev', 'in_development', 'in_review', 'blocked', 'done'] });
  });
});
