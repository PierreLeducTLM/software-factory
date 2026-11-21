import { useState } from 'react';
import type { NeedsYouCategory, NeedsYouItem } from '../../../src/view/model.js';
import { waiting } from '../format';
import { CopyCommand } from './CopyCommand';

type Props = { readonly items: readonly NeedsYouItem[]; readonly now: string; readonly copy?: (text: string) => Promise<void> };

const CATEGORIES: readonly NeedsYouCategory[] = ['blocked', 'run_limit', 'interrupted', 'record_edited', 'sent_back', 'merge', 'approve', 'not_started'];

const LABELS: Readonly<Record<NeedsYouCategory, string>> = {
  blocked: 'Blocked',
  run_limit: 'Run limit reached',
  interrupted: 'Interrupted',
  record_edited: 'Record edited',
  sent_back: 'Sent back',
  merge: 'Ready to merge',
  approve: 'Approve spec',
  not_started: 'Not started',
};

const TONES: Readonly<Record<NeedsYouCategory, string>> = {
  blocked: 'fail',
  run_limit: 'fail',
  interrupted: 'warn',
  record_edited: 'warn',
  sent_back: 'warn',
  merge: 'info',
  approve: 'good',
  not_started: 'muted',
};

export function NeedsYou({ items, now, copy }: Props) {
  const [filter, setFilter] = useState<NeedsYouCategory | 'all'>('all');
  const present = CATEGORIES.filter((category) => items.some((item) => item.category === category));
  const shown = items.filter((item) => filter === 'all' || item.category === filter);

  return (
    <main className="screen screen--list">
      <h2 className="list__title">Needs you</h2>
      <p className="list__lead">
        Everything waiting on a person, most urgent first. This page changes nothing: each button opens a link or copies a command for you to run in the project.
      </p>
      <div className="filters" role="group" aria-label="Filter">
        <button type="button" className="filter" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All <span className="filter__count">{items.length}</span>
        </button>
        {present.map((category) => (
          <button type="button" className="filter" key={category} aria-pressed={filter === category} onClick={() => setFilter(category)}>
            {LABELS[category]} <span className="filter__count">{items.filter((item) => item.category === category).length}</span>
          </button>
        ))}
      </div>
      {items.length === 0 ? <p className="list__empty">Nothing needs you right now.</p> : null}
      <ul className="items">
        {shown.map((item) => (
          <li className="item" key={`${item.category}-${item.key}`}>
            <div className="item__kind">
              <p className={`item__label tone--${TONES[item.category]}`}>{LABELS[item.category]}</p>
              <p className="item__age">waiting {waiting(item.since, now)}</p>
            </div>
            <div className="item__body">
              <p className="item__head">
                <span className="item__key">{item.key}</span> <strong>{item.title}</strong> <span className="item__provider">{item.provider}</span>
              </p>
              <p>{item.why}</p>
              {item.questions.map(({ question, recommended }) => (
                <div className="question" key={question}>
                  <p className="question__label">Question</p>
                  <p>{question}</p>
                  <p className="question__recommended">Recommended: {recommended}</p>
                </div>
              ))}
            </div>
            <div className="item__actions">
              {item.command === undefined ? null : <CopyCommand command={item.command} {...(copy === undefined ? {} : { copy })} />}
              {item.link === undefined ? null : (
                <a className="button" href={item.link}>
                  {item.category === 'merge' ? 'Open pull request' : 'Open report'}
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
