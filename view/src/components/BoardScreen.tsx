import { useState } from 'react';
import type { Card, Column, RunDetail } from '../../../src/view/model.js';
import type { OpenResult, StartRequest, StartResult } from '../../../src/view/source.js';
import { Board, type Selected } from './Board';
import { RunDetailPanel } from './RunDetailPanel';

type Props = {
  readonly columns: readonly Column[];
  readonly loadDetail: (key: string) => Promise<RunDetail | undefined>;
  readonly copy?: (text: string) => Promise<void>;
  readonly openInOrca?: (key: string) => Promise<OpenResult>;
  readonly startInOrca?: (request: StartRequest) => Promise<StartResult>;
};

type Selection = Selected & { readonly detail: RunDetail | undefined; readonly loading: boolean };

export function BoardScreen({ columns, loadDetail, copy, openInOrca, startInOrca }: Props) {
  const [selection, setSelection] = useState<Selection | undefined>(undefined);
  const matches = (candidate: Card): boolean => candidate.key === selection?.key;
  const card = columns.find((column) => column.id === selection?.column)?.cards.find(matches) ?? columns.flatMap((column) => column.cards).find(matches);

  const select = async ({ column, key }: Selected): Promise<void> => {
    setSelection({ column, key, detail: undefined, loading: true });
    const detail = await loadDetail(key);
    setSelection((current) => (current?.column === column && current.key === key ? { column, key, detail, loading: false } : current));
  };

  return (
    <main className="screen">
      <Board columns={columns} onSelect={select} {...(selection === undefined ? {} : { selected: { column: selection.column, key: selection.key } })} />
      {selection === undefined || card === undefined ? null : (
        <RunDetailPanel
          card={card}
          detail={selection.detail}
          loading={selection.loading}
          onClose={() => setSelection(undefined)}
          {...(copy === undefined ? {} : { copy })}
          {...(openInOrca === undefined ? {} : { openInOrca })}
          {...(startInOrca === undefined ? {} : { startInOrca })}
        />
      )}
    </main>
  );
}
