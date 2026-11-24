import { useState, type ReactNode } from 'react';

const JOKES = [
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  "There are 10 kinds of people: those who understand binary and those who don't.",
  'A SQL query walks into a bar, goes up to two tables and asks: may I join you?',
  'Why did the pull request go to therapy? It had too many unresolved conflicts.',
  'Why did the developer go broke? Because they used up all their cache.',
] as const;

type Props = { readonly children?: ReactNode };

export function JokeButton({ children }: Props) {
  const [shown, setShown] = useState<number | undefined>(undefined);
  const next = () => setShown((current) => (current === undefined ? 0 : (current + 1) % JOKES.length));
  return (
    <>
      <div className="top__actions">
        {children}
        <button type="button" className="button joke-button" onClick={next}>
          Tell me a joke
        </button>
      </div>
      {shown === undefined ? null : (
        <p className="top__joke" role="status">
          {JOKES[shown]}
        </p>
      )}
    </>
  );
}
