import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useMultipliers } from '@/hooks/useMultipliers'
import {
  bracketChanged,
  buildPairList,
  abandonCheckingPairs,
  claimWrite,
  computeHeat,
  formatHeat,
  heatBand,
  isAuthError,
  describeMovesCard,
  describeSuggestedMove,
  HISTORY_FAILED_MOVES,
  historyBlocksMoves,
  listSuggestedMoves,
  movesForSelectedSet,
  localCalendarDate,
  pairKey,
  phaseIsUnstarted,
  playerKeyOf,
  projectBracket,
  projectedPlayerIds,
  isListedSet,
  receiptHeading,
  receiptSetUrl,
  resolveStartGgLink,
  roundIndexTable,
  seedKeyOf,
  shouldApplyGeneration,
  type BracketRow,
  type ProjectedSlot,
  type Receipt,
  type SuggestedMove,
} from '@/lib/rematch/index.ts'
import { cn } from '@/lib/utils'
import { StartGgClient } from '@/lib/startgg/client'
import { WIDE_PAGE_SIZE, loadAliasPairHistories } from '@/lib/startgg/historyBenchmark'
import {
  fetchPairHistory,
  listEliminationPhases,
  loadPhase,
  pushSeeding,
  type LoadedPhase,
  type LookupCache,
  type PairHistoryResult,
  type PhaseInfo,
} from '@/lib/startgg/load'

type PairState =
  | { status: 'checking' }
  | { status: 'cold' }
  | { status: 'no-player-id' }
  | {
      status: 'failed'
      label: string
      context: Receipt | null
      cache: LookupCache
    }
  | { status: 'ready'; heat: number; days: number; receipt: Receipt }

function clockNow(): number {
  return Date.now()
}

function pairStateFromResult(result: PairHistoryResult): PairState {
  if (result.kind === 'cold') return { status: 'cold' }
  if (result.kind === 'history-failed') {
    return {
      status: 'failed',
      label: result.label,
      context: result.context,
      cache: result.cache,
    }
  }
  return {
    status: 'ready',
    days: result.heatDays,
    heat: 0,
    receipt: result.receipt,
  }
}

type WriteLine = {
  phaseName: string
  text: string
  ok: boolean
} | null

export default function App() {
  const [link, setLink] = useState('')
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [phaseChoices, setPhaseChoices] = useState<PhaseInfo[] | null>(null)
  const [loaded, setLoaded] = useState<LoadedPhase | null>(null)
  const [pairs, setPairs] = useState<Map<string, PairState>>(new Map())
  const [selectedMoveId, setSelectedMoveId] = useState<string | null>(null)
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [receiptSetId, setReceiptSetId] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [writeBlocked, setWriteBlocked] = useState(false)
  const [writeLine, setWriteLine] = useState<WriteLine>(null)
  const [pairProgress, setPairProgress] = useState({ done: 0, total: 0 })
  const [loadGen, setLoadGen] = useState(0)
  const [previewSnap, setPreviewSnap] = useState<{
    phaseId: string
    expected: BracketRow[]
    writtenAtGen: number
  } | null>(null)

  const MOVE_SEARCH_DELAY_MS = 200
  const generation = useRef(0)
  const visitMap = useRef(new Map<string, PairState>())
  const visitAsOf = useRef<number | null>(null)
  const visitEventId = useRef<string | null>(null)
  const clientRef = useRef<StartGgClient | null>(null)
  const writeGate = useRef({ inFlight: false })

  const {
    recencyMultiplier,
    roundMultiplier,
    setRecencyMultiplier,
    setRoundMultiplier,
  } = useMultipliers()

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const stopChecking = useCallback(() => {
    setPairs((prev) =>
      abandonCheckingPairs(prev, {
        status: 'failed',
        label: 'history failed',
        context: null,
        cache: { completed: null, unfinished: null },
      }),
    )
  }, [])

  const beginLoad = useCallback(async (phaseId: string, gen: number) => {
    if (!clientRef.current) return
    setStatus('Loading phase…')
    setLoaded(null)
    setPairs(new Map())
    setSelectedMoveId(null)
    setSelectedSetId(null)
    setReceiptSetId(null)
    setWriteBlocked(false)
    setPairProgress({ done: 0, total: 0 })
    try {
      const phase = await loadPhase(clientRef.current, phaseId)
      if (!shouldApplyGeneration(gen, generation.current)) return
      setLoaded(phase)

      if (!phase.elimination) {
        setStatus(`not an elimination phase. ${phase.phase.name}`)
        return
      }
      if (!phase.singlesOnly) {
        setStatus('singles only in this version')
        return
      }
      if (phase.seeds.length === 0) {
        setStatus('This phase has no seeds')
        return
      }

      setStatus(null)
      if (visitAsOf.current !== phase.asOfMs || visitEventId.current !== phase.eventId) {
        visitMap.current.clear()
        visitAsOf.current = phase.asOfMs
        visitEventId.current = phase.eventId
      }
      const list = buildPairList(phase.sets, phase.seeds)
      setPairProgress({ done: 0, total: list.length })

      const next = new Map<string, PairState>()

      for (const { a, b } of list) {
        const key = pairKey(a, b)
        const cached = visitMap.current.get(key)
        if (cached && cached.status !== 'checking') {
          next.set(key, cached)
        } else {
          next.set(key, { status: 'checking' })
        }
      }
      setPairs(new Map(next))

      const nowMs = phase.asOfMs
      let done = [...next.values()].filter((p) => p.status !== 'checking').length
      setPairProgress({ done, total: list.length })

      setLoadGen(gen)
      const pending = list.filter(
        ({ a, b }) => next.get(pairKey(a, b))?.status === 'checking',
      )
      await loadAliasPairHistories(
        clientRef.current!,
        pending,
        nowMs,
        timeZone,
        phase.eventId,
        (key, result) => {
          if (!shouldApplyGeneration(gen, generation.current)) return
          const state = pairStateFromResult(result)
          visitMap.current.set(key, state)
          setPairs((prev) => {
            const copy = new Map(prev)
            copy.set(key, state)
            return copy
          })
          done += 1
          setPairProgress({ done, total: list.length })
        },
        () => shouldApplyGeneration(gen, generation.current),
      )
      if (shouldApplyGeneration(gen, generation.current)) stopChecking()
    } catch (err) {
      if (!shouldApplyGeneration(gen, generation.current)) return
      setStatus(err instanceof Error ? err.message : String(err))
      stopChecking()
    }
  }, [stopChecking, timeZone])

  const onSubmitLink = async () => {
    const resolved = resolveStartGgLink(link)
    if (resolved.kind === 'invalid') {
      setStatus(resolved.reason)
      return
    }
    if (!token.trim()) {
      setStatus('Paste a start.gg token')
      return
    }
    generation.current += 1
    const gen = generation.current
    const trimmed = token.trim()
    clientRef.current?.retire()
    if (!clientRef.current?.usesToken(trimmed)) {
      clientRef.current = new StartGgClient(trimmed)
    }
    setPhaseChoices(null)
    setWriteLine(null)
    setWriteBlocked(false)

    if (resolved.kind === 'bracket') {
      await beginLoad(resolved.phaseId, gen)
      return
    }

    setStatus('Looking up event…')
    try {
      const { phases, allPhases } = await listEliminationPhases(
        clientRef.current,
        resolved.tournamentSlug,
        resolved.eventSlug,
      )
      if (!shouldApplyGeneration(gen, generation.current)) return
      if (phases.length === 0) {
        const names = allPhases.map((phase) => phase.name).join(', ')
        setStatus(
          names
            ? `not an elimination phase. ${names}`
            : 'not an elimination phase',
        )
        stopChecking()
        return
      }
      if (phases.length === 1) {
        await beginLoad(phases[0].id, gen)
        return
      }
      setPhaseChoices(phases)
      setStatus('Pick an elimination phase')
      stopChecking()
    } catch (err) {
      if (!shouldApplyGeneration(gen, generation.current)) return
      setStatus(err instanceof Error ? err.message : String(err))
      stopChecking()
    }
  }

  const pairLookup = useCallback(
    (a: string, b: string) => {
      const state = pairs.get(pairKey(a, b))
      if (!state || state.status === 'checking') return { missing: true as const }
      if (state.status === 'failed') return { failed: true as const }
      return { ok: true as const, heat: 0 }
    },
    [pairs],
  )

  const [moveRecency, setMoveRecency] = useState(recencyMultiplier)
  const [moveRound, setMoveRound] = useState(roundMultiplier)
  useEffect(() => {
    const id = window.setTimeout(() => {
      setMoveRecency(recencyMultiplier)
      setMoveRound(roundMultiplier)
    }, MOVE_SEARCH_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [recencyMultiplier, roundMultiplier])

  const daysByPair = useMemo(() => {
    const map = new Map<string, number>()
    for (const [key, state] of pairs) {
      if (state.status === 'ready') map.set(key, state.days)
      if (state.status === 'cold' || state.status === 'no-player-id') {
        map.set(key, Number.POSITIVE_INFINITY)
      }
    }
    return map
  }, [pairs])

  const projectedRows = useMemo(() => {
    if (!loaded) return []
    return projectBracket(loaded.sets, loaded.seeds)
  }, [loaded])

  const rounds = useMemo(
    () => (loaded ? roundIndexTable(loaded.sets) : new Map<string, number>()),
    [loaded],
  )

  const scoredSets = useMemo(() => {
    if (!loaded) return []
    return projectedRows.map((row) => {
      const set = row.set
      const slots = row.slots
      const missingId = set.slots.some((slot) => slot.entrantId && !slot.playerId)
      if (missingId) {
        return {
          set,
          slots,
          projected: row.projected,
          band: 'plain' as const,
          heat: 0,
          label: 'no player id',
          state: 'ready' as const,
        }
      }
      if (!row.scoreable) {
        return {
          set,
          slots,
          projected: row.projected,
          band: 'plain' as const,
          heat: 0,
          label: null,
          state: 'ready' as const,
        }
      }
      const filled = projectedPlayerIds(slots)
      const key = pairKey(filled[0], filled[1])
      const pair = pairs.get(key)
      if (!pair || pair.status === 'checking') {
        return {
          set,
          slots,
          projected: row.projected,
          band: 'plain' as const,
          heat: 0,
          label: 'checking',
          state: 'checking' as const,
        }
      }
      if (pair.status === 'failed') {
        return {
          set,
          slots,
          projected: row.projected,
          band: 'plain' as const,
          heat: 0,
          label: pair.label,
          state: 'failed' as const,
          context: pair.context,
          cache: pair.cache,
        }
      }
      if (pair.status === 'cold' || pair.status === 'no-player-id') {
        return {
          set,
          slots,
          projected: row.projected,
          band: 'plain' as const,
          heat: 0,
          label: pair.status === 'no-player-id' ? 'no player id' : null,
          state: 'ready' as const,
        }
      }
      if (pair.status !== 'ready') {
        return {
          set,
          slots,
          projected: row.projected,
          band: 'plain' as const,
          heat: 0,
          label: null,
          state: 'ready' as const,
        }
      }
      const ri = rounds.get(set.id) ?? 1
      const heat = computeHeat(pair.days, ri, recencyMultiplier, roundMultiplier)
      const band = heatBand(heat)
      return {
        set,
        slots,
        projected: row.projected,
        band,
        heat,
        label: band === 'plain' ? null : band,
        state: 'ready' as const,
        receipt: pair.receipt,
        days: pair.days,
      }
    })
  }, [loaded, pairs, projectedRows, rounds, recencyMultiplier, roundMultiplier])

  const sortedSets = useMemo(() => {
    return [...scoredSets].sort((a, b) => b.heat - a.heat)
  }, [scoredSets])

  const historyPending = [...pairs.values()].some((pair) => pair.status === 'checking')

  const historyFailed = historyBlocksMoves(
    [...pairs.values()].map((pair) => pair.status),
  )

  const moves: SuggestedMove[] = useMemo(() => {
    if (!loaded || !selectedSetId || historyFailed) return []
    if ([...pairs.values()].some((p) => p.status === 'checking')) return []
    const finiteDays = new Map<string, number>()
    for (const [k, v] of daysByPair) {
      if (Number.isFinite(v)) finiteDays.set(k, v)
    }
    return movesForSelectedSet(
      selectedSetId,
      listSuggestedMoves({
        seeds: loaded.seeds,
        sets: loaded.sets,
        pairHeat: pairLookup,
        daysByPair: finiteDays,
        recencyMultiplier: moveRecency,
        roundMultiplier: moveRound,
        focusSetId: selectedSetId,
        bracketType: loaded.phase.bracketType,
      }),
    )
  }, [
    historyFailed,
    loaded,
    pairs,
    daysByPair,
    pairLookup,
    moveRecency,
    moveRound,
    selectedSetId,
  ])

  const selectedMove = moves.find((m) => m.id === selectedMoveId) ?? null

  const hottestReceiptId =
    sortedSets.find(
      (row) =>
        row.state === 'ready' && row.heat > 0 && 'receipt' in row && row.receipt,
    )?.set.id ?? null
  const activeReceiptId = receiptSetId ?? hottestReceiptId

  const activeReceipt = useMemo(() => {
    const row = scoredSets.find((s) => s.set.id === activeReceiptId)
    if (row && 'receipt' in row && row.receipt) return row
    return sortedSets.find((s) => 'receipt' in s && s.receipt)
  }, [scoredSets, sortedSets, activeReceiptId])

  const unstarted = loaded ? phaseIsUnstarted(loaded.sets) : false
  const canWrite =
    Boolean(
      loaded &&
        token &&
        unstarted &&
        selectedMove &&
        !writing &&
        !writeBlocked,
    )

  const previewNote = useMemo(() => {
    if (!previewSnap || !loaded || previewSnap.phaseId !== loaded.phase.id) {
      return null
    }
    if (loadGen <= previewSnap.writtenAtGen) return null
    if ([...pairs.values()].some((pair) => pair.status === 'checking')) return null
    const actual = scoredSets.map((row) => ({
      seedKey: seedKeyOf(row.set),
      players: playerKeyOf(
        row.slots.map((slot) => (slot.kind === 'player' ? slot.playerId : null)),
      ),
      heat: row.heat,
    }))
    return bracketChanged(previewSnap.expected, actual)
      ? 'The bracket changed from the preview.'
      : null
  }, [previewSnap, loaded, loadGen, pairs, scoredSets])

  const retryPair = async (a: string, b: string) => {
    if (!clientRef.current) return
    const key = pairKey(a, b)
    const cached = visitMap.current.get(key)
    const prior = cached?.status === 'failed' ? cached.cache : undefined
    const gen = generation.current
    setPairs((prev) => {
      const copy = new Map(prev)
      copy.set(key, { status: 'checking' })
      return copy
    })
    const result = await fetchPairHistory(
      clientRef.current,
      a,
      b,
      loaded?.asOfMs ?? clockNow(),
      timeZone,
      prior,
      loaded?.eventId,
      { perPage: WIDE_PAGE_SIZE, combineStates: true },
    )
    if (!shouldApplyGeneration(gen, generation.current)) return
    const state = pairStateFromResult(result)
    visitMap.current.set(key, state)
    setPairs((prev) => {
      const copy = new Map(prev)
      copy.set(key, state)
      return copy
    })
  }

  const onWrite = async () => {
    if (!selectedMove || !loaded || !clientRef.current || writeBlocked) return
    if (!claimWrite(writeGate.current)) return
    setWriting(true)
    const phaseId = loaded.phase.id
    const phaseName = loaded.phase.name
    const mapping = selectedMove.seedMapping
    const expected = selectedMove.expected
    try {
      await pushSeeding(clientRef.current, phaseId, mapping)
      setPreviewSnap({
        phaseId,
        expected,
        writtenAtGen: generation.current,
      })
      setWriteLine({
        phaseName,
        ok: true,
        text: 'Seed list was sent. Refresh to fetch the bracket again.',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setWriteLine({
        phaseName,
        ok: false,
        text: message,
      })
      if (isAuthError(message)) {
        setWriteBlocked(true)
        setStatus(message)
      }
    } finally {
      writeGate.current.inFlight = false
      setWriting(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold">Conflict Resolver</h1>
      <p className="mt-1 text-base text-zinc-600">
        Paste a start.gg elimination bracket. Heat is a recent rematch that sits
        early in the bracket.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <Label htmlFor="link">start.gg link</Label>
          <Input
            id="link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://www.start.gg/tournament/…/event/…"
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="token">start.gg token</Label>
          <Input
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste token"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="mt-1 text-base text-zinc-600">
            This token stays in this tab and is sent only to start.gg.
          </p>
        </div>
        <Button className="w-full" onClick={() => void onSubmitLink()}>
          Load bracket
        </Button>
      </div>

      {status ? (
        <p className="mt-4 rounded-md border border-zinc-400 bg-white px-3 py-2 text-base">
          {status}
        </p>
      ) : null}

      {phaseChoices ? (
        <div className="mt-4 space-y-2">
          <p className="font-semibold">Pick a phase</p>
          {phaseChoices.map((p) => (
            <Button
              key={p.id}
              className="w-full justify-start"
              onClick={() => {
                generation.current += 1
                void beginLoad(p.id, generation.current)
                setPhaseChoices(null)
              }}
            >
              {p.name}
            </Button>
          ))}
        </div>
      ) : null}

      {writeLine ? (
        <p
          className={cn(
            'mt-4 rounded-md border px-3 py-2 text-base',
            writeLine.ok
              ? 'border-zinc-500 bg-white'
              : 'border-red-700 bg-red-50 text-red-900',
          )}
        >
          {writeLine.phaseName}: {writeLine.text}
        </p>
      ) : null}

      {previewNote ? (
        <p className="mt-4 rounded-md border border-zinc-500 bg-white px-3 py-2 text-base">
          {previewNote}
        </p>
      ) : null}

      {loaded &&
      loaded.elimination &&
      loaded.singlesOnly &&
      loaded.seeds.length > 0 ? (
        <>
          <p className="mt-6 text-base text-zinc-600">
            {loaded.phase.name}. {loaded.seeds.length} seeds.
            {pairProgress.total > 0
              ? ` History ${pairProgress.done}/${pairProgress.total}.`
              : null}
            {loaded.ignoreLaterMeetings
              ? ` Meetings after ${localCalendarDate(loaded.asOfMs, timeZone)} are ignored.`
              : null}
            {unstarted
              ? ' No set in this phase has started.'
              : ' A set has started — write is hidden.'}
          </p>

          <section className="mt-4 rounded-md border border-zinc-400 bg-white p-3">
            <p className="mb-2 text-base tracking-wide text-zinc-500 uppercase">
              Bracket
            </p>
            {loaded.sets.length === 0 ? (
              <>
                <ol className="space-y-2">
                  {[...loaded.seeds]
                    .sort((a, b) => a.seedNum - b.seedNum)
                    .map((seed) => (
                      <li
                        key={seed.seedId}
                        className="min-h-11 rounded-md border border-zinc-300 px-3 py-2"
                      >
                        Seed {seed.seedNum}. {seed.gamerTag ?? 'Bye'}
                      </li>
                    ))}
                </ol>
                <p className="mt-2 text-base text-zinc-700">
                  No sets yet. Pairs are not invented.
                </p>
              </>
            ) : (
            <ul className="space-y-2">
              {sortedSets.filter((row) => isListedSet(row.set, row.slots)).map((row) => {
                const selected = selectedSetId === row.set.id
                const players = projectedPlayerIds(row.slots)
                const context = 'context' in row ? row.context : null
                return (
                  <li key={row.set.id}>
                    <div
                      className={cn(
                        'w-full rounded-md border px-3 py-2 text-left',
                        row.band === 'hot' && 'border-zinc-700 bg-[var(--color-heat-hot)]',
                        row.band === 'warm' && 'border-zinc-400 bg-[var(--color-heat-warm)]',
                        row.band === 'plain' && 'border-zinc-300 bg-white',
                        selected && 'ring-2 ring-zinc-900',
                      )}
                    >
                    <button
                      type="button"
                      className="min-h-11 w-full text-left"
                      onClick={() => {
                        setSelectedSetId(row.set.id)
                        if (row.state === 'ready' && 'receipt' in row && row.receipt) {
                          setReceiptSetId(row.set.id)
                        }
                      }}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 font-semibold">
                        {row.slots.map((slot, index) => (
                          <span key={`${row.set.id}-${index}`}>
                            {index > 0 ? (
                              <span className="mr-2 font-normal text-zinc-600">vs</span>
                            ) : null}
                            <SlotName slot={slot} />
                          </span>
                        ))}
                        {row.projected ? (
                          <span className="inline-block rounded border border-zinc-600 px-1.5 font-normal">
                            projected
                          </span>
                        ) : null}
                        {row.label ? (
                          <span className="inline-block rounded border border-zinc-600 px-1.5 font-normal">
                            {row.label}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-base text-zinc-700">
                        {row.set.fullRoundText ?? 'Set'}
                        {row.state === 'ready' && row.heat > 0
                          ? ` · heat ${formatHeat(row.heat)}`
                          : null}
                      </div>
                    </button>
                    {context ? (
                      <p className="mt-1 text-base text-zinc-700">
                        Loaded set {context.eventName}, {context.localDate}. Not
                        the receipt until history finishes.
                      </p>
                    ) : null}
                    {row.state === 'failed' && players.length === 2 ? (
                      <Button
                        className="mt-2 w-full"
                        onClick={() => void retryPair(players[0], players[1])}
                      >
                        Retry history
                      </Button>
                    ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
            )}
          </section>

          <section className="mt-4 rounded-md border border-zinc-400 bg-white p-3">
            <h2 className="text-base font-semibold">Last meeting</h2>
            {activeReceipt && 'receipt' in activeReceipt && activeReceipt.receipt ? (
              <ReceiptBlock
                receipt={activeReceipt.receipt}
                names={entrantNames(activeReceipt.slots)}
              />
            ) : (
              <p className="mt-2 text-base text-zinc-600">
                Tap a settled match to open its last meeting.
              </p>
            )}
          </section>

          <section className="mt-4 rounded-md border border-zinc-400 bg-white p-3">
            <h2 className="text-base font-semibold">
              Moves for the selected set
            </h2>
            {!selectedSetId ? (
              <p className="mt-2 text-base text-zinc-700">
                Select a set to see moves that cool it.
              </p>
            ) : historyPending ? (
              <p className="mt-2 text-base text-zinc-700">
                Still reading history. The move appears when every pair is settled.
              </p>
            ) : historyFailed ? (
              <p className="mt-2 text-base text-zinc-700">{HISTORY_FAILED_MOVES}</p>
            ) : moves.length === 0 ? (
              <p className="mt-2 text-base text-zinc-700">
                No move cools this set without heating another.
              </p>
            ) : (
              <>
                <p className="mt-2 text-base text-zinc-700">{describeMovesCard(moves)}</p>
                <ul className="mt-2 space-y-2">
                  {moves.map((m) => (
                    <li key={m.id}>
                      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-zinc-300 px-3 py-2 has-[:checked]:border-zinc-900">
                        <input
                          type="radio"
                          name="move"
                          className="mt-1 size-4"
                          checked={selectedMoveId === m.id}
                          onChange={() => setSelectedMoveId(m.id)}
                        />
                        <span>
                          {describeSuggestedMove(m)}
                          {m.placementNotes.map((note) => (
                            <span key={note} className="mt-1 block">
                              {note}
                            </span>
                          ))}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {selectedMove ? (
              <div className="mt-3 space-y-1 text-base text-zinc-700">
                {selectedMove.preview.map((p) => (
                  <p key={p.setId}>
                    {p.kind === 'heat'
                      ? `${p.before} → ${p.after} (${formatHeat(p.oldHeat ?? 0)} → ${formatHeat(p.newHeat ?? 0)})`
                      : p.kind === 'bye-changed'
                        ? `${p.before} → ${p.after} (bye changed)`
                        : `${p.before} → ${p.after}`}
                  </p>
                ))}
              </div>
            ) : null}

            {unstarted && moves.length > 0 && !writeBlocked ? (
              <Button
                className="mt-4 w-full"
                disabled={!canWrite}
                onClick={() => void onWrite()}
              >
                {writing ? 'Sending…' : 'Push this order to start.gg'}
              </Button>
            ) : null}
            {!unstarted ? (
              <p className="mt-3 text-base text-zinc-600">
                After the first set starts, this button is gone. The suggestion
                stays. Edit the bracket by hand on start.gg.
              </p>
            ) : null}
          </section>

          <details className="mt-4 rounded-md border border-zinc-400 bg-white p-3">
            <summary className="min-h-11 cursor-pointer font-semibold">
              Advanced
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="recency">Recency multiplier</Label>
                <Input
                  id="recency"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={recencyMultiplier}
                  onChange={(e) =>
                    setRecencyMultiplier(Number(e.target.value) || 1)
                  }
                />
              </div>
              <div>
                <Label htmlFor="round">Round multiplier</Label>
                <Input
                  id="round"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={roundMultiplier}
                  onChange={(e) =>
                    setRoundMultiplier(Number(e.target.value) || 1)
                  }
                />
              </div>
            </div>
            <p className="mt-2 text-base text-zinc-600">
              Saved on this browser only. Token and sets are not stored.
            </p>
          </details>
        </>
      ) : null}
    </div>
  )
}

function entrantNames(slots: ProjectedSlot[]): string {
  return slots
    .map((slot) => {
      if (slot.kind === 'player') return slot.gamerTag ?? 'player'
      if (slot.kind === 'bye') return 'Bye'
      return 'Unresolved'
    })
    .join(' vs ')
}

function SlotName({ slot }: { slot: ProjectedSlot }) {
  if (slot.kind === 'bye') return 'Bye'
  if (slot.kind === 'unresolved') return 'Unresolved'
  return (
    <>
      {slot.gamerTag ?? 'unknown'}
      {slot.seedNum != null ? (
        <span className="ml-2 font-normal text-zinc-600">seed {slot.seedNum}</span>
      ) : null}
    </>
  )
}

function ReceiptBlock({
  receipt,
  names,
}: {
  receipt: Receipt
  names: string
}) {
  const href = receiptSetUrl(
    receipt.tournamentSlug,
    receipt.eventSlug,
    receipt.setId,
  )
  return (
    <div className="mt-2 text-base">
      <p className="font-semibold">{names}</p>
      <dl className="mt-2 space-y-2">
        <div>
          <dt className="text-zinc-500">When</dt>
          <dd>
            {receipt.localDate} · {receipt.exactDays} days
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Event</dt>
          <dd>{receiptHeading(receipt.tournamentName, receipt.eventName)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Round</dt>
          <dd>{receipt.roundText || '—'}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Result</dt>
          <dd>{receipt.winnerTag ? `${receipt.winnerTag} won` : '—'}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Set</dt>
          <dd>
            <a href={href} target="_blank" rel="noreferrer">
              Open on start.gg
            </a>{' '}
            <span className="text-base text-zinc-500">(set {receipt.setId})</span>
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-base text-zinc-600">
        If this set is the wrong people, the glow is wrong. This page cannot fix
        aliases. It only shows the set.
      </p>
    </div>
  )
}
