import { useState } from 'react';

type Props = { readonly command: string; readonly copy?: (text: string) => Promise<void> };

const LABELS = { idle: 'Copy command', copied: 'Copied', failed: 'Copy failed: select the text' } as const;

const toClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

export function CopyCommand({ command, copy = toClipboard }: Props) {
  const [state, setState] = useState<keyof typeof LABELS>('idle');
  return (
    <div className="command">
      <code>{command}</code>
      <button
        type="button"
        className="button button--primary"
        onClick={() =>
          copy(command).then(
            () => setState('copied'),
            () => setState('failed'),
          )
        }
      >
        {LABELS[state]}
      </button>
    </div>
  );
}
