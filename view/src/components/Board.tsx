import type { Card, Chip, Column } from '../../../src/view/model.js';
import { duration } from '../format';

type Props = { readonly columns: readonly Column[]; readonly selected?: string; readonly onSelect: (key: string) => void };

const RISK_LABELS = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const;
const CHIP_NAMES = { pass: 'passed', fail: 'failed', running: 'running', pending: 'not started' } as const;
const GATES = ['build', 'gate', 'verify', 'review'] as const;

const statusOf = (card: Card, columnId: Column['id']): Chip | 'waiting' => {
  if (card.interrupted || columnId === 'pr') return 'waiting';
  if (columnId === 'done') return 'pass';
  if (columnId === 'needs_you') return card.note.startsWith('Blocked') ? 'fail' : 'waiting';
  return columnId === 'ready' ? 'pending' : 'running';
};

function CardButton({ card, columnId, selected, onSelect }: { readonly card: Card; readonly columnId: Column['id']; readonly selected: boolean; readonly onSelect: (key: string) => void }) {
  const meta = [
    card.attempt === undefined ? undefined : `attempt ${card.attempt.number}/${card.attempt.limit}`,
    card.seconds === undefined ? undefined : duration(card.seconds),
  ].filter((part) => part !== undefined);
  return (
    <button type="button" className={`card${selected ? ' card--selected' : ''}`} aria-pressed={selected} aria-label={`Open ${card.key} ${card.title}`} onClick={() => onSelect(card.key)}>
      <span className="card__top">
        <span className={`dot dot--${statusOf(card, columnId)}`} aria-hidden="true" />
        <span className="card__key">{card.key}</span>
        <span className="card__provider">{card.provider}</span>
      </span>
      <span className="card__title">{card.title}</span>
      <span className="card__who">
        <span>
          {card.claimant ?? 'Unclaimed'}
          {card.run === undefined ? '' : ` · run ${card.run.number} of ${card.run.limit}`}
        </span>
        {card.risk === undefined ? null : <span className={`risk risk--${card.risk}`}>{RISK_LABELS[card.risk]} (predicted)</span>}
      </span>
      {card.rows.map((row) => (
        <span className="attempt" key={row.number} aria-label={`Attempt ${row.number}`}>
          <span className="attempt__label">A{row.number}</span>
          {GATES.map((gate) => (
            <span key={gate} className={`chip chip--${row[gate]}`} title={`${gate}: ${CHIP_NAMES[row[gate]]}`}>
              {gate}
              <span className="visually-hidden"> {CHIP_NAMES[row[gate]]}</span>
            </span>
          ))}
        </span>
      ))}
      {card.earlierAttempts === 0 ? null : <span className="card__more">+{card.earlierAttempts} earlier {card.earlierAttempts === 1 ? 'attempt' : 'attempts'}</span>}
      <span className="card__bottom">
        <span className={card.interrupted ? 'note note--warn' : 'note'}>{card.note}</span>
        <span className="card__meta">{meta.join(' · ')}</span>
      </span>
      {card.recordEdited ? <span className="note note--warn">Record edited outside the factory</span> : null}
    </button>
  );
}

export function Board({ columns, selected, onSelect }: Props) {
  return (
    <section className="board" aria-label="Pipeline">
      {columns.map((column) => (
        <div className="column" key={column.id}>
          <h2 className={column.id === 'needs_you' ? 'column__name column__name--warn' : 'column__name'}>
            {column.name} <span className="column__count">{column.cards.length}</span>
          </h2>
          {column.cards.length === 0 ? <p className="column__empty">Nothing here</p> : null}
          {column.cards.map((card) => (
            <CardButton key={card.key} card={card} columnId={column.id} selected={card.key === selected} onSelect={onSelect} />
          ))}
        </div>
      ))}
    </section>
  );
}
