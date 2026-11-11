import { cn } from '@/lib/utils'
import type { InputHTMLAttributes } from 'react'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'min-h-11 w-full rounded-md border border-border bg-bg px-3 py-2 text-base text-ink outline-none',
        'focus:border-accent',
        className,
      )}
      {...props}
    />
  )
}
