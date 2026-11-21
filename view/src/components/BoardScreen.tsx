import { useState } from 'react';
import type { Column, RunDetail } from '../../../src/view/model.js';
import { Board } from './Board';
import { RunDetailPanel } from './RunDetailPanel';

type Props = {
  readonly columns: readonly Column[];
  readonly loadDetail: (key: string) => Promise<RunDetail | undefined>;
  readonly copy?: (text: string) => Promise<void>;
};

type Selection = { readonly key: string; readonly detail: RunDetail | undefined; readonly loading: boolean };

export function BoardScreen({ columns, loadDetail, copy }: Props) {
  const [selection, setSelection] = useState<Selection | undefined>(undefined);
  const card = columns.flatMap((column) => column.cards).find((candidate) => candidate.key === selection?.key);

  const select = async (key: string): Promise<void> => {
    setSelection({ key, detail: undefined, loading: true });
    const detail = await loadDetail(key);
    setSelection((current) => (current?.key === key ? { key, detail, loading: false } : current));
  };

  return (
    <main className="screen">
      <Board columns={columns} onSelect={select} {...(selection === undefined ? {} : { selected: selection.key })} />
      {selection === undefined || card === undefined ? null : (
        <RunDetailPanel card={card} detail={selection.detail} loading={selection.loading} onClose={() => setSelection(undefined)} {...(copy === undefined ? {} : { copy })} />
      )}
    </main>
  );
}
