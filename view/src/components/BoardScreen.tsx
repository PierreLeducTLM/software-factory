import { useNavigate, useRouter, useSearch, type AnyRouter } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Card, Column, ColumnId, NeedsYouItem, RunDetail } from '../../../src/view/model.js';
import type { OpenResult, StartRequest, StartResult } from '../../../src/view/source.js';
import { Board, type OnSelect, type Selected } from './Board';
import { NeedsYouStrip } from './NeedsYouStrip';
import { RunDetailPanel } from './RunDetailPanel';

export type CardSearch = { readonly card?: string; readonly column?: ColumnId };

const COLUMN_IDS: Readonly<Record<ColumnId, true>> = { available: true, refining: true, ready: true, revalidate: true, build: true, review: true, pr: true, needs_you: true, done: true };

const isColumnId = (value: unknown): value is ColumnId => typeof value === 'string' && Object.hasOwn(COLUMN_IDS, value);

export const cardSearch = (search: Record<string, unknown>): CardSearch => {
  const card = search['card'];
  const column = search['column'];
  if (typeof card !== 'string') return {};
  return isColumnId(column) ? { card, column } : { card };
};

type LoadDetail = (key: string) => Promise<RunDetail | undefined>;

export type CardAddress = {
  readonly card: string | undefined;
  readonly column: ColumnId | undefined;
  readonly show: (selected: Selected, replace: boolean) => void;
  readonly close: (closed: () => void) => void;
  readonly forget: () => void;
};

type Props = {
  readonly address?: CardAddress;
  readonly columns: readonly Column[];
  readonly needsYou?: readonly NeedsYouItem[];
  readonly providers?: number;
  readonly loadDetail: LoadDetail;
  readonly copy?: (text: string) => Promise<void>;
  readonly openInOrca?: (key: string) => Promise<OpenResult>;
  readonly startInOrca?: (request: StartRequest) => Promise<StartResult>;
};

type Placed = { readonly column: Column['id']; readonly card: Card };

type Loaded = { readonly key: string; readonly detail: RunDetail | undefined };

const locate = (columns: readonly Column[], key: string | undefined, preferred: ColumnId | undefined): Placed | undefined => {
  const placed = columns.flatMap((column) => column.cards.filter((card) => card.key === key).map((card) => ({ column: column.id, card })));
  return placed.find(({ column }) => column === preferred) ?? placed.find(({ column }) => column === 'needs_you') ?? placed[0];
};

const useDetail = (key: string | undefined, loadDetail: LoadDetail): Loaded | undefined => {
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const load = useRef(loadDetail);
  useLayoutEffect(() => {
    load.current = loadDetail;
  });
  useEffect(() => {
    if (key === undefined) return undefined;
    const request = new AbortController();
    void load.current(key).then((detail) => {
      if (!request.signal.aborted) setLoaded({ key, detail });
    });
    return () => request.abort();
  }, [key]);
  return loaded?.key === key ? loaded : undefined;
};

const useMemoryAddress = (): CardAddress => {
  const [selected, setSelected] = useState<Selected | undefined>(undefined);
  const clear = (): void => setSelected(undefined);
  const close = (closed: () => void): void => {
    clear();
    closed();
  };
  return { card: selected?.key, column: selected?.column, show: setSelected, close, forget: clear };
};

type Scroll = { readonly x: number; readonly y: number };

const isDrawerClose = (from: { readonly pathname: string; readonly search: CardSearch } | undefined, to: { readonly pathname: string; readonly search: CardSearch }): boolean =>
  from?.pathname === '/' && from.search.card !== undefined && to.pathname === '/' && to.search.card === undefined;

const useScrollKeptOnClose = (router: AnyRouter): void =>
  useEffect(() => {
    const kept: { current: Scroll | undefined } = { current: undefined };
    const leave = router.subscribe('onBeforeLoad', ({ fromLocation, toLocation }) => {
      kept.current = isDrawerClose(fromLocation, toLocation) ? { x: window.scrollX, y: window.scrollY } : undefined;
    });
    const arrive = router.subscribe('onRendered', () => {
      if (kept.current === undefined) return;
      window.scrollTo(kept.current.x, kept.current.y);
      kept.current = undefined;
    });
    return () => {
      leave();
      arrive();
    };
  }, [router]);

export const useCardAddress = (): CardAddress => {
  const { card, column } = useSearch({ from: '/' });
  const navigate = useNavigate();
  const router = useRouter();
  const pushed = useRef(false);
  useScrollKeptOnClose(router);
  const show = (selected: Selected, replace: boolean): void => {
    pushed.current = pushed.current || !replace;
    void navigate({ to: '/', search: { card: selected.key, column: selected.column }, replace, resetScroll: false });
  };
  const forget = (): void => {
    pushed.current = false;
    void navigate({ to: '/', search: {}, replace: true, resetScroll: false });
  };
  const close = (closed: () => void): void => {
    const unsubscribe = router.subscribe('onRendered', () => {
      unsubscribe();
      closed();
    });
    return pushed.current ? router.history.back() : forget();
  };
  return { card, column, show, close, forget };
};

export function BoardScreen({ address: routed, columns, needsYou = [], providers = 1, loadDetail, copy, openInOrca, startInOrca }: Props) {
  const memory = useMemoryAddress();
  const address = routed ?? memory;
  const opener = useRef<HTMLElement | null>(null);
  const open = locate(columns, address.card, address.column);
  const loaded = useDetail(open?.card.key, loadDetail);
  const missing = address.card !== undefined && open === undefined;
  const { forget } = address;

  useEffect(() => {
    if (missing) forget();
  }, [missing, forget]);

  const select: OnSelect = (selected, element) => {
    opener.current = element;
    address.show(selected, open !== undefined);
  };

  const returnFocus = (): void => {
    const element = opener.current;
    if (element === null || !element.isConnected) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest' });
  };

  const close = (): void => address.close(returnFocus);

  return (
    <main className="screen">
      <NeedsYouStrip items={needsYou} onOpen={(key, element) => select({ column: 'needs_you', key }, element)} />
      <Board columns={columns} providers={providers} onSelect={select} {...(open === undefined ? {} : { selected: { column: open.column, key: open.card.key } })} />
      {open === undefined ? null : (
        <RunDetailPanel
          key={`${open.column}-${open.card.key}`}
          card={open.card}
          detail={loaded?.detail}
          loading={loaded === undefined}
          onClose={close}
          {...(copy === undefined ? {} : { copy })}
          {...(openInOrca === undefined ? {} : { openInOrca })}
          {...(startInOrca === undefined ? {} : { startInOrca })}
        />
      )}
    </main>
  );
}
