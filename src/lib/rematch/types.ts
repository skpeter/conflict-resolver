export type HeatBand = 'hot' | 'warm' | 'plain'

export type PairStatus =
  | { kind: 'checking' }
  | { kind: 'heat'; heat: number; days: number; clockMs: number; receipt: Receipt }
  | { kind: 'cold' }
  | { kind: 'history-failed'; label: string }
  | { kind: 'no-player-id' }

export type Receipt = {
  setId: string
  eventName: string
  eventSlug: string
  tournamentName: string
  tournamentSlug: string
  roundText: string
  winnerTag: string | null
  localDate: string
  exactDays: number
  fromCompleted: boolean
}

export type SeedSlot = {
  seedId: string
  seedNum: number
  entrantId: string | null
  playerId: string | null
  gamerTag: string | null
  participantCount: number
}

export type SetSlot = {
  slotIndex: number
  seedNum: number | null
  entrantId: string | null
  playerId: string | null
  gamerTag: string | null
  prereqId: string | null
  prereqType: string | null
  prereqPlacement: number | null
}

export type PhaseSet = {
  id: string
  state: number | string | null
  round: number | null
  fullRoundText: string | null
  winnerId: string | null
  hasReportedGames: boolean
  slots: SetSlot[]
}

export type HistorySet = {
  id: string
  state: number
  completedAt: number | null
  startedAt: number | null
  fullRoundText: string | null
  winnerId: string | null
  eventName: string
  eventId: string | null
  eventSlug: string
  eventStartAt: number | null
  tournamentName: string
  tournamentSlug: string
  slots: Array<{
    gamerTag: string | null
    playerId: string | null
    entrantId: string | null
  }>
}

export type SuggestedMove = {
  id: string
  seedNumFrom: number
  seedNumTo: number
  entrantTag: string
  playerId: string
  shift: 1 | 2
  /** Everyone else who changes seeds, from the neighbor out to the destination. */
  shifted: Array<{ tag: string; seedNumFrom: number; seedNumTo: number }>
  /** Hottest heat anywhere on the bracket after this slide. */
  newHottest: number
  /** Heat of the selected set before and after the slide. Null when no set is selected. */
  setHeatBefore: number | null
  setHeatAfter: number | null
  /** Players this slide moves into a worse placement tier for this bracket format. */
  placementNotes: string[]
  seedMapping: Array<{ seedId: string; seedNum: number }>
  preview: PreviewRow[]
  expected: Array<{ seedKey: string; players: string; heat: number }>
}

export type PreviewRow = {
  setId: string
  before: string
  after: string
  kind: 'heat' | 'bye-changed' | 'bye-other'
  oldHeat: number | null
  newHeat: number | null
}
