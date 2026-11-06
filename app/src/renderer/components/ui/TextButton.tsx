import type { ButtonHTMLAttributes } from 'react';

/**
 * An action inside a sentence: reads as a link and sizes with the text around it, where a bordered Button would
 * break the line. Still a real button: it takes focus, and shows the app's focus ring when you tab to it.
 */
export function TextButton({ className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={`rounded-sm text-left text-link hover:underline disabled:opacity-60 disabled:hover:no-underline ${className}`} {...rest} />;
}
