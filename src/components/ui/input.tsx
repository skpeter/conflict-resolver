import { cn } from '@/lib/utils'
import type { InputHTMLAttributes } from 'react'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'min-h-11 w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-base text-zinc-900 outline-none',
        'focus:border-zinc-900',
        className,
      )}
      {...props}
    />
  )
}
