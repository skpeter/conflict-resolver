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
        'inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-900 bg-white px-4 py-2 text-base font-semibold text-zinc-900',
        'hover:bg-zinc-100 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:text-zinc-400',
        className,
      )}
      {...props}
    />
  )
}
