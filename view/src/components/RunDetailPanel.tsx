import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Card, RunDetail } from '../../../src/view/model.js';
import type { OpenResult, StartRequest, StartResult } from '../../../src/view/source.js';
import { CopyCommand } from './CopyCommand';
import { OpenInOrca } from './OpenInOrca';
import { StartInOrca } from './StartInOrca';

type Props = {
  readonly card: Card;
  readonly detail: RunDetail | undefined;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly copy?: (text: string) => Promise<void>;
  readonly openInOrca?: (key: string) => Promise<OpenResult>;
  readonly startInOrca?: (request: StartRequest) => Promise<StartResult>;
};

const STATUS_NAMES = { pass: 'passed', fail: 'failed', running: 'in progress', pending: 'not started' } as const;

const isLink = (text: string): boolean => /^https?:\/\//.test(text);

const useEscape = (onEscape: () => void): void =>
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [onEscape]);

const HEADER = 'header.top';

const useBelowHeader = (drawer: RefObject<HTMLElement | null>): void =>
  useLayoutEffect(() => {
    const place = (): void => {
      const bottom = document.querySelector(HEADER)?.getBoundingClientRect().bottom ?? 0;
      drawer.current?.style.setProperty('--drawer-top', `${Math.max(Math.round(bottom), 0)}px`);
    };
    place();
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [drawer]);

export function RunDetailPanel({ card, detail, loading, onClose, copy, openInOrca, startInOrca }: Props) {
  const title = useRef<HTMLHeadingElement>(null);
  const drawer = useRef<HTMLElement>(null);
  useBelowHeader(drawer);
  useEffect(() => title.current?.focus({ preventScroll: true }), []);
  useEscape(onClose);
  return (
    <aside className="detail" aria-label="Run detail" ref={drawer}>
      <header className="detail__header">
        <p className="detail__key">
          {card.key} · {card.provider}
        </p>
        <button type="button" className="icon-button" aria-label="Close run detail" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </header>
      <h2 className="detail__title" ref={title} tabIndex={-1}>
        {card.title}
      </h2>
      <p className="detail__note">{card.note}</p>
      {card.claimant === undefined ? null : <p className="detail__where">{card.onThisMachine ? 'This run is on your machine, in Orca.' : `This run is in ${card.claimant}'s Orca.`}</p>}
      {card.onThisMachine && openInOrca !== undefined ? <OpenInOrca key={card.key} runKey={card.key} open={openInOrca} /> : null}
      {card.command === undefined ? null : <CopyCommand command={card.command} {...(copy === undefined ? {} : { copy })} />}
      {card.command === undefined || card.onThisMachine || startInOrca === undefined ? null : <StartInOrca key={card.key} runKey={card.key} command={card.command} start={startInOrca} />}
      {card.pullRequest === undefined ? null : (
        <p>
          <a className="button" href={card.pullRequest}>
            Open pull request
          </a>
        </p>
      )}
      <p className="detail__source">Everything below is read from the factory comment on {card.key}.</p>
      {loading ? <p role="status">Loading the run…</p> : null}
      {!loading && detail === undefined ? <p>This ticket has no factory record yet.</p> : null}
      {detail?.sections.map((section) => (
        <section key={section.title} className="detail__section">
          <h3>{section.title}</h3>
          {section.steps.length === 0 ? <p className="detail__empty">Nothing recorded.</p> : null}
          <ul className="steps">
            {section.steps.map((step) => (
              <li key={step.label} className="step">
                <p className="step__head">
                  <span className={`dot dot--${step.status}`} aria-hidden="true" />
                  <strong>{step.label}</strong>
                  <span className="step__status">{step.statusName ?? STATUS_NAMES[step.status]}</span>
                </p>
                {step.lines.map((line, index) => (
                  <p className="step__line" key={`${index}-${line}`}>
                    {line}
                  </p>
                ))}
                {step.links.map((link) =>
                  isLink(link) ? (
                    <p key={link}>
                      <a href={link}>{link}</a>
                    </p>
                  ) : (
                    <p className="step__line" key={link}>
                      {link}
                    </p>
                  ),
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
