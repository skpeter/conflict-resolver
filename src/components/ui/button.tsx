import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes } from 'react'

export function Button({
  className,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex min-h-11 items-center justify-center rounded-md border border-accent bg-accent px-4 py-2 text-base font-semibold text-ink',
        'hover:border-accent-strong hover:bg-accent-strong disabled:cursor-not-allowed disabled:border-border disabled:bg-surface disabled:text-muted',
        className,
      )}
      {...props}
    />
  )
}
