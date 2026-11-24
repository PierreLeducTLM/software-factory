import type { Card, Chip, Column } from '../../../src/view/model.js';
import { duration } from '../format';

export type Selected = { readonly column: Column['id']; readonly key: string };

export type OnSelect = (selected: Selected, opener: HTMLElement) => void;

type Props = { readonly columns: readonly Column[]; readonly providers: number; readonly selected?: Selected; readonly onSelect: OnSelect };

const RISK_LABELS = { low: 'Low', medium: 'Medium', high: 'High' } as const;
const CHIP_NAMES = { pass: 'passed', fail: 'failed', running: 'running', pending: 'not started' } as const;
const GATES = ['build', 'gate', 'verify', 'review'] as const;
const FAILED_CATEGORIES: readonly (Card['category'] | undefined)[] = ['blocked', 'run_limit', 'revert'];
const NOT_STARTED_COLUMNS: readonly Column['id'][] = ['available', 'ready'];

const statusOf = (card: Card, columnId: Column['id']): Chip | 'waiting' => {
  if (card.interrupted || columnId === 'pr') return 'waiting';
  if (columnId === 'done') return 'pass';
  if (columnId === 'needs_you') return FAILED_CATEGORIES.includes(card.category) ? 'fail' : 'waiting';
  return NOT_STARTED_COLUMNS.includes(columnId) ? 'pending' : 'running';
};

type CardProps = { readonly card: Card; readonly columnId: Column['id']; readonly showProvider: boolean; readonly selected: boolean; readonly onSelect: OnSelect };

function CardButton({ card, columnId, showProvider, selected, onSelect }: CardProps) {
  const meta = [
    card.attempt === undefined ? undefined : `attempt ${card.attempt.number}/${card.attempt.limit}`,
    card.seconds === undefined ? undefined : duration(card.seconds),
  ].filter((part) => part !== undefined);
  return (
    <button type="button" className={`card${selected ? ' card--selected' : ''}`} aria-pressed={selected} aria-label={`Open ${card.key} ${card.title}`} onClick={(event) => onSelect({ column: columnId, key: card.key }, event.currentTarget)}>
      <span className="card__top">
        <span className={`dot dot--${statusOf(card, columnId)}`} aria-hidden="true" />
        <span className="card__key">{card.key}</span>
        {showProvider ? <span className="card__provider">{card.provider}</span> : null}
      </span>
      <span className="card__title">{card.title}</span>
      <span className="card__who">
        <span>
          {card.claimant ?? 'Unclaimed'}
          {card.run === undefined ? '' : ` · run ${card.run.number} of ${card.run.limit}`}
        </span>
        {card.risk === undefined ? null : (
          <span className={`risk risk--${card.risk}`} role="img" aria-label={`${RISK_LABELS[card.risk]} risk (predicted)`}>
            {RISK_LABELS[card.risk]}
          </span>
        )}
      </span>
      {card.rows.map((row) => (
        <span className="attempt" key={row.number} aria-label={`Attempt ${row.number}`}>
          {GATES.map((gate) => (
            <span key={gate} className={`chip chip--${row[gate]}`} title={`${gate} ${CHIP_NAMES[row[gate]]}`}>
              {gate.charAt(0)}
              <span className="visually-hidden">{` ${gate} ${CHIP_NAMES[row[gate]]}`}</span>
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

export function Board({ columns, providers, selected, onSelect }: Props) {
  return (
    <section className="board" aria-label="Pipeline">
      {columns.map((column) => (
        <div className={column.cards.length === 0 ? 'column column--empty' : 'column'} key={column.id}>
          <h2 className={column.id === 'needs_you' ? 'column__name column__name--warn' : 'column__name'}>
            {column.name} <span className="column__count">{column.cards.length}</span>
          </h2>
          {column.cards.map((card) => (
            <CardButton key={card.key} card={card} columnId={column.id} showProvider={providers > 1} selected={column.id === selected?.column && card.key === selected.key} onSelect={onSelect} />
          ))}
        </div>
      ))}
    </section>
  );
}
