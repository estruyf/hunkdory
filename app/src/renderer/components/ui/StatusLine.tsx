import { Loader2 } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

export type StatusDot = 'ok' | 'caution' | 'error' | 'neutral' | 'empty' | 'busy';

const DOT: Record<Exclude<StatusDot, 'busy'>, string> = {
  ok: 'bg-ok',
  caution: 'bg-caution',
  error: 'bg-error',
  neutral: 'bg-faint',
  // Not done yet: an outline, so it reads apart from the filled ones without its colour.
  empty: 'border-2 border-faint',
};

interface StatusLineProps extends Omit<HTMLAttributes<HTMLParagraphElement>, 'children'> {
  dot: StatusDot;
  /** In bold, before the sentence. */
  label: ReactNode;
  /** Body size and text colour, for the line to read first. The others are smaller and muted. */
  lead?: boolean;
  /** The sentence, with its action as a `TextButton` in it. */
  children: ReactNode;
}

/** One short line of status: a dot, a bold label, a sentence. A list of them sits under a top border. */
export function StatusLine({ dot, label, lead = false, children, className = '', ...rest }: StatusLineProps) {
  return (
    <p className={`m-0 break-words ${lead ? 'text-body text-text' : 'text-ui text-muted'} ${className}`} {...rest}>
      {dot === 'busy' ? (
        <Loader2 size={11} className="mr-1.5 inline-block animate-spin align-[-1px] text-accent-ink" aria-hidden />
      ) : (
        <span aria-hidden className={`mr-1.5 inline-block size-[7px] rounded-full align-[1px] ${DOT[dot]}`} />
      )}
      <strong className="font-semibold text-text">{label}</strong> {children}
    </p>
  );
}
