export type BracketFormat = 'single' | 'double' | 'other'

export function bracketFormat(bracketType: string | null | undefined): BracketFormat {
  const kind = (bracketType ?? '').toUpperCase()
  if (kind === 'DOUBLE_ELIMINATION') return 'double'
  if (kind === 'SINGLE_ELIMINATION') return 'single'
  return 'other'
}

/**
 * Upset-free place for a seed. Several seeds share one place, so that place
 * is the tie ("tied for 17th"). Single elim and double elim use different cuts.
 */
export function tiedPlace(format: BracketFormat, seed: number): number | null {
  if (format === 'other' || seed < 1) return null
  if (format === 'single') {
    if (seed <= 2) return seed
    let block = 2
    while (block * 2 < seed) block *= 2
    return block + 1
  }
  if (seed <= 4) return seed
  let block = 4
  while (block * 2 < seed) block *= 2
  const half = block / 2
  if (seed <= block + half) return block + 1
  return block + half + 1
}

function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function placePhrase(format: BracketFormat, seed: number): string | null {
  const place = tiedPlace(format, seed)
  if (place == null) return null
  const word = ordinal(place)
  const shares =
    tiedPlace(format, seed + 1) === place ||
    (seed > 1 && tiedPlace(format, seed - 1) === place)
  return shares ? `tied for ${word}` : word
}

/** A sentence when this player moves into a worse placement tier. */
export function placementDropNote(
  bracketType: string | null | undefined,
  tag: string,
  fromSeed: number,
  toSeed: number,
): string | null {
  const format = bracketFormat(bracketType)
  const before = tiedPlace(format, fromSeed)
  const after = tiedPlace(format, toSeed)
  if (before == null || after == null || after <= before) return null
  const fromPhrase = placePhrase(format, fromSeed)
  const toPhrase = placePhrase(format, toSeed)
  if (!fromPhrase || !toPhrase) return null
  return `${tag} would be ${toPhrase} instead of ${fromPhrase}.`
}

export function placementDropNotes(
  bracketType: string | null | undefined,
  changes: Array<{ tag: string; fromSeed: number; toSeed: number }>,
): string[] {
  const notes: string[] = []
  for (const change of changes) {
    const note = placementDropNote(
      bracketType,
      change.tag,
      change.fromSeed,
      change.toSeed,
    )
    if (note) notes.push(note)
  }
  return notes
}
