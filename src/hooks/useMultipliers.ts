import { useEffect, useState } from 'react'

const KEY = 'conflict-resolver.multipliers'

function readStored(): { recencyMultiplier: number; roundMultiplier: number } {
  const fallback = { recencyMultiplier: 1, roundMultiplier: 1 }
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as {
      recencyMultiplier?: number
      roundMultiplier?: number
    }
    return {
      recencyMultiplier:
        typeof parsed.recencyMultiplier === 'number'
          ? parsed.recencyMultiplier
          : 1,
      roundMultiplier:
        typeof parsed.roundMultiplier === 'number' ? parsed.roundMultiplier : 1,
    }
  } catch {
    return fallback
  }
}

export function useMultipliers() {
  const [values, setValues] = useState(readStored)

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(values))
  }, [values])

  return {
    recencyMultiplier: values.recencyMultiplier,
    roundMultiplier: values.roundMultiplier,
    setRecencyMultiplier: (recencyMultiplier: number) =>
      setValues((current) => ({ ...current, recencyMultiplier })),
    setRoundMultiplier: (roundMultiplier: number) =>
      setValues((current) => ({ ...current, roundMultiplier })),
  }
}
