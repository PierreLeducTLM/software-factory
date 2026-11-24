import { Link } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import type { NeedsYouItem } from '../../../src/view/model.js';

type Props = { readonly items: readonly NeedsYouItem[]; readonly onOpen: (key: string, opener: HTMLElement) => void };

const MAX_LINES = 2;
const useWidth = (element: Element | null): number => {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (element === null) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
};

type Line = { readonly count: number; readonly top: number };

const lineIndexes = (elements: readonly Element[]): readonly number[] =>
  elements
    .map((element) => element.getBoundingClientRect())
    .reduce<{ readonly line: Line; readonly indexes: readonly number[] }>(
      ({ line, indexes }, rect, index) => {
        const next = index === 0 ? { count: 1, top: rect.top } : rect.top >= line.top + rect.height / 2 ? { count: line.count + 1, top: rect.top } : line;
        return { line: next, indexes: [...indexes, next.count] };
      },
      { line: { count: 0, top: 0 }, indexes: [] },
    ).indexes;

const fittingCount = (list: HTMLUListElement, shown: number): number | undefined => {
  const lines = lineIndexes([...list.children]);
  if ((lines.at(-1) ?? 0) <= MAX_LINES) return undefined;
  const fitting = lines.slice(1, shown + 1).filter((line) => line <= MAX_LINES).length;
  return Math.max(Math.min(shown - 1, fitting), 0);
};

export function NeedsYouStrip({ items, onOpen }: Props) {
  const [list, setList] = useState<HTMLUListElement | null>(null);
  const width = useWidth(list);
  const [shown, setShown] = useState(items.length);

  useLayoutEffect(() => setShown(items.length), [items, width, list]);

  useLayoutEffect(() => {
    if (list === null || !list.isConnected) return;
    const fitting = fittingCount(list, shown);
    if (fitting !== undefined) setShown(fitting);
  });

  if (items.length === 0) return null;
  const count = `${items.length} need you`;
  return (
    <nav className="strip" aria-label="Needs you">
      <ul className="strip__items" ref={setList}>
        <li className="strip__count">{count}</li>
        {items.slice(0, shown).map((item) => (
          <li key={`${item.category}-${item.key}`} className="strip__slot">
            <button type="button" className="strip__item" onClick={(event) => onOpen(item.key, event.currentTarget)}>
              <span className="strip__key">{item.key}</span> <span className="strip__why">{item.why}</span>
            </button>
          </li>
        ))}
        {shown < items.length ? (
          <li className="strip__slot">
            <Link to="/needs-you" className="strip__more">
              +{items.length - shown} more
            </Link>
          </li>
        ) : null}
      </ul>
      <Link to="/needs-you" className="strip__count strip__count--link strip__phone">
        {count}
      </Link>
    </nav>
  );
}
