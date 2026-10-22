import {
  ELIM_BRACKET_TYPES,
  HISTORY_PAGE_SIZE,
  ageDays,
  classifyHistoryPage,
  fillMissingSeedNums,
  historyAsOf,
  orderedPlayerIds,
  pickReceiptClock,
  setClock,
  shouldIgnoreLaterMeetings,
  startGgPathSegment,
} from '../rematch/index.ts'
import { exactDayCount, localCalendarDate } from '../rematch/receipt.ts'
import type {
  HistorySet,
  PhaseSet,
  Receipt,
  SeedSlot,
} from '../rematch/types.ts'
import { StartGgClient } from './client.ts'
import {
  EVENT_PHASES,
  H2H_SETS,
  PHASE_SEEDS,
  PHASE_SETS,
  UPDATE_PHASE_SEEDING,
} from './queries.ts'

export type PhaseInfo = {
  id: string
  name: string
  bracketType: string
}

export type LoadedPhase = {
  phase: PhaseInfo
  seeds: SeedSlot[]
  sets: PhaseSet[]
  singlesOnly: boolean
  elimination: boolean
  /** Event start when that start is already past, otherwise the load-time clock. */
  asOfMs: number
  /** Captured at load so render does not read the clock again. */
  ignoreLaterMeetings: boolean
  eventId: string | null
}

type SeedNode = {
  id: string
  seedNum: number
  entrant: {
    id: string
    participants: Array<{
      gamerTag: string | null
      player: { id: string } | null
    }>
  } | null
}

type SetNode = {
  id: string
  state: number | null
  round: number | null
  fullRoundText: string | null
  winnerId: string | null
  games: Array<{ id: string }> | null
  slots: Array<{
    slotIndex: number
    seed: { id: string; seedNum: number } | null
    prereqId: string | null
    prereqType: string | null
    prereqPlacement: number | null
    entrant: {
      id: string
      participants: Array<{
        gamerTag: string | null
        player: { id: string } | null
      }>
    } | null
  }>
}

export type H2HNode = {
  id: string
  state: number
  completedAt: number | null
  startedAt: number | null
  fullRoundText: string | null
  winnerId: string | null
  event: {
    id: string | number
    name: string
    slug: string
    startAt: number | null
    tournament: { slug: string; name?: string | null } | null
  } | null
  slots: Array<{
    entrant: {
      id: string
      participants: Array<{
        gamerTag: string | null
        player: { id: string } | null
      }>
    } | null
  }>
}

export async function listEliminationPhases(
  client: StartGgClient,
  tournamentSlug: string,
  eventSlug: string,
): Promise<{ eventName: string; phases: PhaseInfo[]; allPhases: PhaseInfo[] }> {
  const tournament = startGgPathSegment(tournamentSlug, 'tournament')
  const event = startGgPathSegment(eventSlug, 'event')
  const slug = `tournament/${tournament}/event/${event}`
  const data = await client.request<{
    event: {
      name: string
      phases: Array<{ id: string; name: string; bracketType: string }>
    } | null
  }>(EVENT_PHASES, { slug })
  if (!data.event) throw new Error('Event not found')
  const allPhases = data.event.phases.map((p) => ({
    id: String(p.id),
    name: p.name,
    bracketType: p.bracketType,
  }))
  const phases = allPhases.filter((p) => ELIM_BRACKET_TYPES.has(p.bracketType))
  return { eventName: data.event.name, phases, allPhases }
}

export async function loadPhase(
  client: StartGgClient,
  phaseId: string,
): Promise<LoadedPhase> {
  const { seeds, eventId, eventStartAt } = await paginateSeeds(client, phaseId)
  const { phase, sets } = await paginateSets(client, phaseId)
  const singlesOnly = seeds.every((s) => s.participantCount <= 1)
  const elimination = ELIM_BRACKET_TYPES.has(phase.bracketType)
  const nowMs = Date.now()
  const asOfMs = historyAsOf(startGgUnixToMs(eventStartAt), nowMs)
  return {
    phase,
    seeds,
    sets: fillMissingSeedNums(sets, seeds),
    singlesOnly,
    elimination,
    asOfMs,
    ignoreLaterMeetings: shouldIgnoreLaterMeetings(asOfMs, nowMs),
    eventId,
  }
}

async function paginateSeeds(
  client: StartGgClient,
  phaseId: string,
): Promise<{ seeds: SeedSlot[]; eventId: string | null; eventStartAt: number | null }> {
  const out: SeedSlot[] = []
  let page = 1
  let eventId: string | null = null
  let eventStartAt: number | null = null
  while (true) {
    const data = await client.request<{
      phase: {
        id: string
        name: string
        bracketType: string
        event: { id: string | number; startAt: number | null } | null
        seeds: { nodes: SeedNode[] } | null
      } | null
    }>(PHASE_SEEDS, { phaseId, page })
    if (!data.phase) throw new Error('Phase not found')
    if (page === 1) {
      eventId = data.phase.event?.id != null ? String(data.phase.event.id) : null
      eventStartAt = data.phase.event?.startAt ?? null
    }
    const nodes = data.phase.seeds?.nodes ?? []
    for (const n of nodes) {
      const parts = n.entrant?.participants ?? []
      out.push({
        seedId: String(n.id),
        seedNum: n.seedNum,
        entrantId: n.entrant?.id ? String(n.entrant.id) : null,
        playerId: parts[0]?.player?.id ? String(parts[0].player.id) : null,
        gamerTag: parts[0]?.gamerTag ?? null,
        participantCount: parts.length,
      })
    }
    if (nodes.length < 32) break
    page += 1
  }
  return { seeds: out, eventId, eventStartAt }
}

async function paginateSets(
  client: StartGgClient,
  phaseId: string,
): Promise<{ phase: PhaseInfo; sets: PhaseSet[] }> {
  const sets: PhaseSet[] = []
  let page = 1
  let phase: PhaseInfo | null = null
  while (true) {
    const data = await client.request<{
      phase: {
        id: string
        name?: string
        bracketType?: string
        sets: { nodes: SetNode[] } | null
      } | null
    }>(PHASE_SETS, { phaseId, page })
    if (!data.phase) throw new Error('Phase not found')
    if (!phase) {
      // name/bracketType come from seeds query; fill from first sets page if present
      phase = {
        id: String(data.phase.id),
        name: data.phase.name ?? `Phase ${phaseId}`,
        bracketType: data.phase.bracketType ?? '',
      }
    }
    const nodes = data.phase.sets?.nodes ?? []
    for (const n of nodes) {
      sets.push({
        id: String(n.id),
        state: n.state,
        round: n.round,
        fullRoundText: n.fullRoundText,
        winnerId: n.winnerId != null ? String(n.winnerId) : null,
        hasReportedGames: (n.games?.length ?? 0) > 0,
        slots: n.slots.map((s) => {
          const parts = s.entrant?.participants ?? []
          return {
            slotIndex: s.slotIndex,
            seedNum: s.seed?.seedNum ?? null,
            entrantId: s.entrant?.id ? String(s.entrant.id) : null,
            playerId: parts[0]?.player?.id
              ? String(parts[0].player.id)
              : null,
            gamerTag: parts[0]?.gamerTag ?? null,
            prereqId: s.prereqId != null ? String(s.prereqId) : null,
            prereqType: s.prereqType,
            prereqPlacement: s.prereqPlacement,
          }
        }),
      })
    }
    if (nodes.length < 32) break
    page += 1
  }
  // Reload seeds page 1 for phase meta if needed
  const meta = await client.request<{
    phase: { id: string; name: string; bracketType: string } | null
  }>(PHASE_SEEDS, { phaseId, page: 1 })
  if (meta.phase) {
    phase = {
      id: String(meta.phase.id),
      name: meta.phase.name,
      bracketType: meta.phase.bracketType,
    }
  }
  return { phase: phase!, sets }
}

export type LookupCache = {
  completed: HistorySet[] | null
  unfinished: HistorySet[] | null
}

export type PairHistoryResult =
  | {
      kind: 'heat'
      heatDays: number
      receipt: Receipt
    }
  | { kind: 'cold' }
  | {
      kind: 'history-failed'
      label: string
      context: Receipt | null
      cache: LookupCache
    }

/**
 * Two parallel lookups: completed state [3], unfinished [2,4,6].
 * Each walks at most 5 pages. Full fifth page still in window → incomplete.
 */
export type HistoryFetchOptions = {
  perPage?: number
  /** One lookup for completed and unfinished states. Baseline keeps them split. */
  combineStates?: boolean
}

export async function fetchPairHistory(
  client: StartGgClient,
  playerA: string,
  playerB: string,
  nowMs: number,
  timeZone: string,
  prior?: LookupCache,
  excludeEventId?: string | null,
  options?: HistoryFetchOptions,
): Promise<PairHistoryResult> {
  const { lowerId, higherId } = orderedPlayerIds(playerA, playerB)
  const perPage = options?.perPage ?? HISTORY_PAGE_SIZE
  if (options?.combineStates) {
    const combined = await walkLookup(
      client,
      lowerId,
      higherId,
      [2, 3, 4, 6],
      nowMs,
      perPage,
    )
    const completedSets = combined.sets.filter((set) => set.state === 3)
    const unfinishedSets = combined.sets.filter((set) => set.state !== 3)
    return resultFromLookups(
      {
        sets: completedSets,
        failed: combined.failed,
        incomplete: combined.incomplete,
      },
      {
        sets: unfinishedSets,
        failed: combined.failed,
        incomplete: combined.incomplete,
      },
      nowMs,
      timeZone,
      excludeEventId,
    )
  }
  const [completed, unfinished] = await Promise.all([
    prior?.completed
      ? Promise.resolve({
          sets: prior.completed,
          failed: false,
          incomplete: false,
        })
      : walkLookup(client, lowerId, higherId, [3], nowMs, perPage),
    prior?.unfinished
      ? Promise.resolve({
          sets: prior.unfinished,
          failed: false,
          incomplete: false,
        })
      : walkLookup(client, lowerId, higherId, [2, 4, 6], nowMs, perPage),
  ])

  return resultFromLookups(
    completed,
    unfinished,
    nowMs,
    timeZone,
    excludeEventId,
  )
}

function resultFromLookups(
  completed: { sets: HistorySet[]; failed: boolean; incomplete: boolean },
  unfinished: { sets: HistorySet[]; failed: boolean; incomplete: boolean },
  nowMs: number,
  timeZone: string,
  excludeEventId?: string | null,
): PairHistoryResult {
  const cache: LookupCache = {
    completed: completed.failed || completed.incomplete ? null : completed.sets,
    unfinished: unfinished.failed || unfinished.incomplete ? null : unfinished.sets,
  }
  const label =
    completed.incomplete || unfinished.incomplete
      ? 'history may be incomplete'
      : 'history failed'

  if (completed.failed || unfinished.failed || completed.incomplete || unfinished.incomplete) {
    return {
      kind: 'history-failed',
      label,
      context: receiptForSets(completed.sets, true, nowMs, timeZone, excludeEventId),
      cache,
    }
  }

  const candidates = candidatesFrom(completed.sets, true, excludeEventId).concat(
    candidatesFrom(unfinished.sets, false, excludeEventId),
  )
  const picked = pickReceiptClock(
    nowMs,
    candidates.map((c) => ({
      clockMs: c.clockMs,
      fromCompleted: c.fromCompleted,
    })),
  )
  if (!picked) return { kind: 'cold' }

  const match = candidates.find(
    (c) =>
      c.clockMs === picked.clockMs &&
      c.fromCompleted === picked.fromCompleted,
  )
  if (!match) return { kind: 'cold' }

  const days = ageDays(nowMs, match.clockMs)
  if (days == null) return { kind: 'cold' }
  const receipt = toReceipt(match.set, match.clockMs, days, timeZone, match.fromCompleted)
  return { kind: 'heat', heatDays: days, receipt }
}

export function receiptFromHistorySets(
  sets: HistorySet[],
  nowMs: number,
  timeZone: string,
  excludeEventId?: string | null,
  incomplete = false,
): PairHistoryResult {
  const completed = sets.filter((set) => set.state === 3)
  const unfinished = sets.filter((set) => set.state !== 3)
  return resultFromLookups(
    { sets: completed, failed: false, incomplete },
    { sets: unfinished, failed: false, incomplete },
    nowMs,
    timeZone,
    excludeEventId,
  )
}

function candidatesFrom(
  sets: HistorySet[],
  fromCompleted: boolean,
  excludeEventId?: string | null,
) {
  const out: Array<{ clockMs: number; fromCompleted: boolean; set: HistorySet }> = []
  for (const set of sets) {
    if (excludeEventId && set.eventId === excludeEventId) continue
    const clock = setClock({
      completedAt: set.completedAt,
      eventStartAt: set.eventStartAt,
    })
    if (!clock) continue
    out.push({ clockMs: clock.clockMs, fromCompleted, set })
  }
  return out
}

function receiptForSets(
  sets: HistorySet[],
  fromCompleted: boolean,
  nowMs: number,
  timeZone: string,
  excludeEventId?: string | null,
): Receipt | null {
  const candidates = candidatesFrom(sets, fromCompleted, excludeEventId)
  const picked = pickReceiptClock(
    nowMs,
    candidates.map((c) => ({
      clockMs: c.clockMs,
      fromCompleted: c.fromCompleted,
    })),
  )
  if (!picked) return null
  const match = candidates.find((c) => c.clockMs === picked.clockMs)
  if (!match) return null
  const days = ageDays(nowMs, match.clockMs)
  if (days == null) return null
  return toReceipt(match.set, match.clockMs, days, timeZone, fromCompleted)
}

function toReceipt(
  set: HistorySet,
  clockMs: number,
  days: number,
  timeZone: string,
  fromCompleted: boolean,
): Receipt {
  const winnerTag =
    set.slots.find((s) => s.entrantId === set.winnerId)?.gamerTag ?? null
  return {
    setId: set.id,
    eventName: set.eventName,
    eventSlug: set.eventSlug,
    tournamentName: set.tournamentName,
    tournamentSlug: set.tournamentSlug,
    roundText: set.fullRoundText ?? '',
    winnerTag,
    localDate: localCalendarDate(clockMs, timeZone),
    exactDays: Number(exactDayCount(days)),
    fromCompleted,
  }
}

async function walkLookup(
  client: StartGgClient,
  lowerId: string,
  higherId: string,
  state: number[],
  nowMs: number,
  perPage = HISTORY_PAGE_SIZE,
): Promise<{
  sets: HistorySet[]
  failed: boolean
  incomplete: boolean
}> {
  const sets: HistorySet[] = []
  try {
    for (let page = 1; page <= 5; page += 1) {
      const data = await client.request<{
        player: {
          sets: { nodes: H2HNode[] } | null
        } | null
      }>(H2H_SETS, {
        playerId: lowerId,
        opponentId: higherId,
        page,
        perPage,
        state,
      })
      const nodes = data.player?.sets?.nodes ?? []
      const mapped = nodes
        .map(mapHistorySet)
        .filter((s): s is HistorySet => s != null)
      // Skip team sets (not exactly one participant per side) — mapHistorySet returns null
      sets.push(...mapped)

      const clocksMs = mapped.map((s) => {
        const clock = setClock({
          completedAt: s.completedAt,
          eventStartAt: s.eventStartAt,
        })
        return clock?.clockMs ?? null
      })
      const decision = classifyHistoryPage(
        page,
        nodes.length,
        clocksMs,
        nowMs,
        perPage,
      )
      if (decision === 'incomplete') {
        return { sets, failed: false, incomplete: true }
      }
      if (decision === 'done') {
        return { sets, failed: false, incomplete: false }
      }
    }
  } catch {
    return { sets, failed: true, incomplete: false }
  }
  return { sets, failed: false, incomplete: false }
}

/**
 * start.gg clocks are unix seconds. A value already in milliseconds
 * (1e12 or more) is left alone so a caller that pre-converted stays valid.
 */
function startGgUnixToMs(value: number | null): number | null {
  if (value == null) return null
  if (Math.abs(value) < 1_000_000_000_000) return value * 1000
  return value
}

export function mapHistorySet(n: H2HNode): HistorySet | null {
  const slots = (n.slots ?? []).map((s) => {
    const parts = s.entrant?.participants ?? []
    if (parts.length !== 1) return null
    return {
      gamerTag: parts[0]?.gamerTag ?? null,
      playerId: parts[0]?.player?.id ? String(parts[0].player.id) : null,
      entrantId: s.entrant?.id ? String(s.entrant.id) : null,
    }
  })
  if (slots.some((s) => s == null)) return null
  if (slots.length !== 2) return null
  const eventSlug = startGgPathSegment(n.event?.slug ?? '', 'event')
  return {
    id: String(n.id),
    state: n.state,
    completedAt: startGgUnixToMs(n.completedAt),
    startedAt: startGgUnixToMs(n.startedAt),
    fullRoundText: n.fullRoundText,
    winnerId: n.winnerId != null ? String(n.winnerId) : null,
    eventName: n.event?.name ?? '',
    eventId: n.event?.id != null ? String(n.event.id) : null,
    eventSlug,
    eventStartAt: startGgUnixToMs(n.event?.startAt ?? null),
    tournamentName: n.event?.tournament?.name ?? '',
    tournamentSlug: startGgPathSegment(n.event?.tournament?.slug ?? '', 'tournament'),
    slots: slots as HistorySet['slots'],
  }
}

export async function pushSeeding(
  client: StartGgClient,
  phaseId: string,
  seedMapping: Array<{ seedId: string; seedNum: number }>,
): Promise<void> {
  await client.request(UPDATE_PHASE_SEEDING, { phaseId, seedMapping })
}
