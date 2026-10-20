import { cn } from '@/lib/utils'
import type { LabelHTMLAttributes } from 'react'

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1 block text-base font-semibold text-zinc-800', className)}
      {...props}
    />
  )
}
