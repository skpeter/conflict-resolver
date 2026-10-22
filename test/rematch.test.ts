import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WINDOW_MS,
  ageDays,
  applySeedShift,
  bracketChanged,
  buildPairList,
  claimWrite,
  classifyHistoryPage,
  computeHeat,
  exactDayCount,
  fillMissingSeedNums,
  heatBand,
  historyAsOf,
  inWindow,
  localCalendarDate,
  orderedPlayerIds,
  pairKey,
  phaseIsUnstarted,
  pickReceiptClock,
  resolveStartGgLink,
  roundIndex,
  setClock,
  shouldApplyGeneration,
  describeMovesCard,
  describeSuggestedMove,
  listSuggestedMoves,
  movesForSelectedSet,
  placementDropNote,
  tiedPlace,
  projectBracket,
  projectedPlayerIds,
  isByeSet,
  receiptHeading,
  receiptSetUrl,
  shouldIgnoreLaterMeetings,
} from '../src/lib/rematch/index.ts'
import type { PhaseSet, SeedSlot, SuggestedMove } from '../src/lib/rematch/types.ts'

const DAY = 86_400_000

describe('clock', () => {
  it('uses completedAt even when startedAt is empty', () => {
    const now = 1_000_000_000_000
    const completed = now - 9 * DAY
    const clock = setClock({ completedAt: completed, eventStartAt: now - 10 * DAY })
    assert.equal(clock?.clockMs, completed)
    assert.equal(clock?.fromCompleted, true)
    assert.equal(ageDays(now, completed), 9)
  })

  it('falls back to event.startAt when completedAt is missing', () => {
    const now = 1_000_000_000_000
    const start = now - 3 * DAY
    const clock = setClock({ completedAt: null, eventStartAt: start })
    assert.equal(clock?.clockMs, start)
    assert.equal(clock?.fromCompleted, false)
  })

  it('does not count a set with neither clock', () => {
    assert.equal(setClock({ completedAt: null, eventStartAt: null }), null)
  })

  it('ignores a future clock', () => {
    const now = 1_000_000_000_000
    assert.equal(ageDays(now, now + 1000), null)
    assert.equal(inWindow(now, now + 1000), false)
  })

  it('treats clock equal to now as 0 days', () => {
    const now = 1_000_000_000_000
    assert.equal(ageDays(now, now), 0)
    assert.equal(inWindow(now, now), true)
  })

  it('scores a past event as of its start and an upcoming event as of now', () => {
    const now = 1_000_000_000_000
    assert.equal(historyAsOf(null, now), now)
    assert.equal(historyAsOf(now + DAY, now), now)
    assert.equal(historyAsOf(now - 13 * DAY, now), now - 13 * DAY)
  })

  it('decides the cutoff note from the load-time clock', () => {
    const now = 1_000_000_000_000
    assert.equal(shouldIgnoreLaterMeetings(now, now), false)
    assert.equal(shouldIgnoreLaterMeetings(now - 59_000, now), false)
    assert.equal(shouldIgnoreLaterMeetings(now - 60_001, now), true)
  })

  it('keeps exactly 60*24h and drops one millisecond older', () => {
    const now = 1_000_000_000_000
    assert.equal(inWindow(now, now - WINDOW_MS), true)
    assert.equal(inWindow(now, now - WINDOW_MS - 1), false)
  })

  it('prefers the completed set when clocks are equal', () => {
    const now = 1_000_000_000_000
    const clockMs = now - DAY
    const picked = pickReceiptClock(now, [
      { clockMs, fromCompleted: false },
      { clockMs, fromCompleted: true },
    ])
    assert.equal(picked?.fromCompleted, true)
  })

  it('picks the newer clock', () => {
    const now = 1_000_000_000_000
    const picked = pickReceiptClock(now, [
      { clockMs: now - 10 * DAY, fromCompleted: true },
      { clockMs: now - 2 * DAY, fromCompleted: false },
    ])
    assert.equal(picked?.clockMs, now - 2 * DAY)
  })
})

describe('heat', () => {
  it('makes a 7-day round 1 hotter than a same-day round 2', () => {
    const r1 = computeHeat(7, 1)
    const r2 = computeHeat(0, 2)
    assert.equal(r1, 0.5)
    assert.equal(r2, 0.25)
    assert.ok(r1 > r2)
  })

  it('makes a 9-day round 1 hotter than a same-day round 2', () => {
    const r1 = computeHeat(9, 1)
    assert.ok(Math.abs(r1 - 0.4375) < 1e-9)
    assert.ok(r1 > 0.25)
  })

  it('makes a 46-day round 1 cooler than a same-day round 2', () => {
    const r1 = computeHeat(46, 1)
    assert.ok(r1 < 0.25)
    assert.ok(Math.abs(r1 - 1 / (1 + 46 / 7)) < 1e-9)
  })

  it('crosses same-day round 2 around 21 days', () => {
    assert.ok(computeHeat(21, 1) - 0.25 < 1e-9)
    assert.ok(Math.abs(computeHeat(21, 1) - 0.25) < 1e-9)
  })

  it('leaves round 1 unchanged when round multiplier rises', () => {
    assert.equal(computeHeat(0, 1, 1, 2), 1)
    assert.ok(computeHeat(0, 2, 1, 2) < 0.25)
  })

  it('cools old sets when recency multiplier rises', () => {
    assert.ok(computeHeat(7, 1, 2) < 0.5)
    assert.equal(computeHeat(0, 1, 2), 1)
  })

  it('bands hot at 0.25 and warm below', () => {
    assert.equal(heatBand(0.25), 'hot')
    assert.equal(heatBand(0.4375), 'hot')
    assert.equal(heatBand(0.13), 'warm')
    assert.equal(heatBand(0), 'plain')
  })
})

describe('receipt format', () => {
  it('formats a local calendar date in a fixed timezone', () => {
    // 2026-03-15 12:00 UTC
    const ms = Date.UTC(2026, 2, 15, 12, 0, 0)
    assert.equal(localCalendarDate(ms, 'UTC'), '2026-03-15')
    assert.equal(localCalendarDate(ms, 'America/New_York'), '2026-03-15')
  })

  it('shows the exact day count the formula used', () => {
    assert.equal(exactDayCount(9), '9')
    assert.equal(exactDayCount(9.5), '9.5')
  })
})

describe('pairs', () => {
  it('orders player ids as base-10 integers', () => {
    assert.deepEqual(orderedPlayerIds('20', '3'), {
      lowerId: '3',
      higherId: '20',
    })
    assert.equal(pairKey('20', '3'), '3|20')
  })

  it('includes current pairs and a pair created by a one-slot move', () => {
    const seeds: SeedSlot[] = [
      { seedId: 's1', seedNum: 1, entrantId: 'e1', playerId: '10', gamerTag: 'A', participantCount: 1 },
      { seedId: 's2', seedNum: 2, entrantId: 'e2', playerId: '20', gamerTag: 'B', participantCount: 1 },
      { seedId: 's3', seedNum: 3, entrantId: 'e3', playerId: '30', gamerTag: 'C', participantCount: 1 },
      { seedId: 's4', seedNum: 4, entrantId: 'e4', playerId: '40', gamerTag: 'D', participantCount: 1 },
    ]
    const sets: PhaseSet[] = [
      {
        id: 'set1',
        state: 1,
        round: 1,
        fullRoundText: 'Winners Round 1',
        winnerId: null,
        hasReportedGames: false,
        slots: [
          { slotIndex: 1, seedNum: 1, entrantId: 'e1', playerId: '10', gamerTag: 'A', prereqId: null, prereqType: null, prereqPlacement: null },
          { slotIndex: 2, seedNum: 4, entrantId: 'e4', playerId: '40', gamerTag: 'D', prereqId: null, prereqType: null, prereqPlacement: null },
        ],
      },
      {
        id: 'set2',
        state: 1,
        round: 1,
        fullRoundText: 'Winners Round 1',
        winnerId: null,
        hasReportedGames: false,
        slots: [
          { slotIndex: 1, seedNum: 2, entrantId: 'e2', playerId: '20', gamerTag: 'B', prereqId: null, prereqType: null, prereqPlacement: null },
          { slotIndex: 2, seedNum: 3, entrantId: 'e3', playerId: '30', gamerTag: 'C', prereqId: null, prereqType: null, prereqPlacement: null },
        ],
      },
    ]
    const pairs = buildPairList(sets, seeds)
    const keys = new Set(pairs.map((p) => pairKey(p.a, p.b)))
    assert.ok(keys.has('10|40'))
    assert.ok(keys.has('20|30'))
    // Moving seed 1 to 2 creates 20 vs 40 on set1
    assert.ok(keys.has('20|40'))
  })

  it('slides people between a 1-slot and a 2-slot move', () => {
    const seeds: SeedSlot[] = [
      { seedId: 's5', seedNum: 5, entrantId: 'e5', playerId: '50', gamerTag: 'Rin', participantCount: 1 },
      { seedId: 's6', seedNum: 6, entrantId: 'e6', playerId: '60', gamerTag: 'Bo', participantCount: 1 },
      { seedId: 's7', seedNum: 7, entrantId: 'e7', playerId: '70', gamerTag: 'X', participantCount: 1 },
    ]
    const one = applySeedShift(seeds, 5, 1)!
    assert.equal(one.get(5)?.playerId, '60')
    assert.equal(one.get(6)?.playerId, '50')
    const two = applySeedShift(seeds, 5, 2)!
    assert.equal(two.get(5)?.playerId, '60')
    assert.equal(two.get(6)?.playerId, '70')
    assert.equal(two.get(7)?.playerId, '50')
  })
})

describe('roundIndex', () => {
  it('counts prerequisite wins and ignores byes', () => {
    const r1a: PhaseSet = {
      id: 'r1a',
      state: 1,
      round: 1,
      fullRoundText: 'Winners Round 1',
      winnerId: null,
      hasReportedGames: false,
      slots: [
        { slotIndex: 1, seedNum: 1, entrantId: 'e1', playerId: '1', gamerTag: 'A', prereqId: null, prereqType: null, prereqPlacement: null },
        { slotIndex: 2, seedNum: 8, entrantId: 'e8', playerId: '8', gamerTag: 'H', prereqId: null, prereqType: null, prereqPlacement: null },
      ],
    }
    const r1b: PhaseSet = {
      id: 'r1b',
      state: 1,
      round: 1,
      fullRoundText: 'Winners Round 1',
      winnerId: null,
      hasReportedGames: false,
      slots: [
        { slotIndex: 1, seedNum: 4, entrantId: 'e4', playerId: '4', gamerTag: 'D', prereqId: null, prereqType: 'BYE', prereqPlacement: null },
        { slotIndex: 2, seedNum: 5, entrantId: 'e5', playerId: '5', gamerTag: 'E', prereqId: null, prereqType: null, prereqPlacement: null },
      ],
    }
    const final: PhaseSet = {
      id: 'wf',
      state: 1,
      round: 2,
      fullRoundText: 'Winners Final',
      winnerId: null,
      hasReportedGames: false,
      slots: [
        { slotIndex: 1, seedNum: null, entrantId: null, playerId: null, gamerTag: null, prereqId: 'r1a', prereqType: 'SET', prereqPlacement: 1 },
        { slotIndex: 2, seedNum: null, entrantId: null, playerId: null, gamerTag: null, prereqId: 'r1b', prereqType: 'SET', prereqPlacement: 1 },
      ],
    }
    const all = [r1a, r1b, final]
    assert.equal(roundIndex(r1a, all), 1)
    assert.equal(roundIndex(final, all), 2)
  })

  it('counts one win per set along the shorter chain', () => {
    const slot = (
      prereqId: string | null,
    ): PhaseSet['slots'][number] => ({
      slotIndex: 1,
      seedNum: null,
      entrantId: null,
      playerId: null,
      gamerTag: null,
      prereqId,
      prereqType: prereqId ? 'SET' : null,
      prereqPlacement: prereqId ? 1 : null,
    })
    const r1: PhaseSet = {
      id: 'r1',
      state: 1,
      round: 1,
      fullRoundText: 'Winners Round 1',
      winnerId: null,
      hasReportedGames: false,
      slots: [slot(null), { ...slot(null), slotIndex: 2 }],
    }
    const r2: PhaseSet = {
      id: 'r2',
      state: 1,
      round: 2,
      fullRoundText: 'Winners Quarter-Final',
      winnerId: null,
      hasReportedGames: false,
      slots: [slot('r1'), { ...slot('r1'), slotIndex: 2 }],
    }
    const r3: PhaseSet = {
      id: 'r3',
      state: 1,
      round: 3,
      fullRoundText: 'Winners Semi-Final',
      winnerId: null,
      hasReportedGames: false,
      slots: [slot('r2'), { ...slot('r2'), slotIndex: 2 }],
    }
    const all = [r1, r2, r3]
    assert.equal(roundIndex(r1, all), 1)
    assert.equal(roundIndex(r2, all), 2)
    assert.equal(roundIndex(r3, all), 3)
  })

  it('does not invent a grand final when only the reset is present', () => {
    const reset: PhaseSet = {
      id: 'gfr',
      state: 1,
      round: 1,
      fullRoundText: 'Grand Final Reset',
      winnerId: null,
      hasReportedGames: false,
      slots: [
        {
          slotIndex: 1,
          seedNum: null,
          entrantId: null,
          playerId: null,
          gamerTag: null,
          prereqId: null,
          prereqType: null,
          prereqPlacement: null,
        },
      ],
    }
    assert.equal(roundIndex(reset, [reset]), 1)
  })
})

describe('moves and write gate', () => {
  it('hides a move that reads a history-failed pair', () => {
    const seeds: SeedSlot[] = [
      { seedId: 's1', seedNum: 1, entrantId: 'e1', playerId: '10', gamerTag: 'A', participantCount: 1 },
      { seedId: 's2', seedNum: 2, entrantId: 'e2', playerId: '20', gamerTag: 'B', participantCount: 1 },
      { seedId: 's3', seedNum: 3, entrantId: 'e3', playerId: '30', gamerTag: 'C', participantCount: 1 },
      { seedId: 's4', seedNum: 4, entrantId: 'e4', playerId: '40', gamerTag: 'D', participantCount: 1 },
    ]
    const sets: PhaseSet[] = [
      {
        id: 'set1',
        state: 1,
        round: 1,
        fullRoundText: 'Winners Round 1',
        winnerId: null,
        hasReportedGames: false,
        slots: [
          { slotIndex: 1, seedNum: 1, entrantId: 'e1', playerId: '10', gamerTag: 'A', prereqId: null, prereqType: null, prereqPlacement: null },
          { slotIndex: 2, seedNum: 4, entrantId: 'e4', playerId: '40', gamerTag: 'D', prereqId: null, prereqType: null, prereqPlacement: null },
        ],
      },
      {
        id: 'set2',
        state: 1,
        round: 1,
        fullRoundText: 'Winners Round 1',
        winnerId: null,
        hasReportedGames: false,
        slots: [
          { slotIndex: 1, seedNum: 2, entrantId: 'e2', playerId: '20', gamerTag: 'B', prereqId: null, prereqType: null, prereqPlacement: null },
          { slotIndex: 2, seedNum: 3, entrantId: 'e3', playerId: '30', gamerTag: 'C', prereqId: null, prereqType: null, prereqPlacement: null },
        ],
      },
    ]
    const daysByPair = new Map<string, number>([
      ['10|40', 1],
      ['20|30', 40],
    ])
    const moves = listSuggestedMoves({
      seeds,
      sets,
      daysByPair,
      pairHeat: (a, b) => {
        const key = pairKey(a, b)
        if (key === '20|40') return { failed: true }
        if (daysByPair.has(key)) {
          return { ok: true, heat: computeHeat(daysByPair.get(key)!, 1) }
        }
        return { missing: true }
      },
    })
    assert.ok(!moves.some((m) => m.id.includes('1->2') || m.seedNumTo === 2))
  })

  it('requires a cooler hottest heat and returns at most three', () => {
    const seeds: SeedSlot[] = [
      { seedId: 's1', seedNum: 1, entrantId: 'e1', playerId: '10', gamerTag: 'A', participantCount: 1 },
      { seedId: 's2', seedNum: 2, entrantId: 'e2', playerId: '20', gamerTag: 'B', participantCount: 1 },
      { seedId: 's3', seedNum: 3, entrantId: 'e3', playerId: '30', gamerTag: 'C', participantCount: 1 },
      { seedId: 's4', seedNum: 4, entrantId: 'e4', playerId: '40', gamerTag: 'D', participantCount: 1 },
    ]
    const sets: PhaseSet[] = [
      {
        id: 'set1',
        state: 1,
        round: 1,
        fullRoundText: 'Winners Round 1',
        winnerId: null,
        hasReportedGames: false,
        slots: [
          { slotIndex: 1, seedNum: 1, entrantId: 'e1', playerId: '10', gamerTag: 'A', prereqId: null, prereqType: null, prereqPlacement: null },
          { slotIndex: 2, seedNum: 4, entrantId: 'e4', playerId: '40', gamerTag: 'D', prereqId: null, prereqType: null, prereqPlacement: null },
        ],
      },
      {
        id: 'set2',
        state: 1,
        round: 1,
        fullRoundText: 'Winners Round 1',
        winnerId: null,
        hasReportedGames: false,
        slots: [
          { slotIndex: 1, seedNum: 2, entrantId: 'e2', playerId: '20', gamerTag: 'B', prereqId: null, prereqType: null, prereqPlacement: null },
          { slotIndex: 2, seedNum: 3, entrantId: 'e3', playerId: '30', gamerTag: 'C', prereqId: null, prereqType: null, prereqPlacement: null },
        ],
      },
    ]
    const daysByPair = new Map<string, number>([
      ['10|40', 1],
      ['20|30', 50],
      ['10|30', 50],
      ['20|40', 50],
      ['10|20', 50],
      ['30|40', 50],
    ])
    const moves = listSuggestedMoves({
      seeds,
      sets,
      daysByPair,
      pairHeat: (a, b) => {
        const key = pairKey(a, b)
        const days = daysByPair.get(key)
        if (days == null) return { missing: true }
        return { ok: true, heat: computeHeat(days, 1) }
      },
    })
    assert.ok(moves.length >= 1)
    assert.ok(moves.length <= 3)
    assert.ok(moves.every((m) => m.newHottest < computeHeat(1, 1)))
  })

  it('treats CREATED as unstarted and CALLED as started', () => {
    const base: PhaseSet = {
      id: 's',
      state: 1,
      round: 1,
      fullRoundText: 'Winners Round 1',
      winnerId: null,
      hasReportedGames: false,
      slots: [],
    }
    assert.equal(phaseIsUnstarted([{ ...base, state: 1 }]), true)
    assert.equal(phaseIsUnstarted([{ ...base, state: null }]), true)
    assert.equal(phaseIsUnstarted([{ ...base, state: 6 }]), false)
    assert.equal(phaseIsUnstarted([{ ...base, state: 3 }]), false)
    assert.equal(
      phaseIsUnstarted([{ ...base, state: 1, winnerId: 'e1' }]),
      false,
    )
  })
})

describe('history page', () => {
  const now = 1_000_000_000_000

  it('marks a full fifth page still inside the window as incomplete', () => {
    const clocks = Array.from({ length: 5 }, () => now - 9 * DAY)
    assert.equal(classifyHistoryPage(5, 5, clocks, now), 'incomplete')
  })

  it('ends a full fifth page that is already outside the window', () => {
    const clocks = Array.from({ length: 5 }, () => now - WINDOW_MS - 1)
    assert.equal(classifyHistoryPage(5, 5, clocks, now), 'done')
  })

  it('keeps walking an old full page before the fifth page', () => {
    assert.equal(
      classifyHistoryPage(2, 5, [now - WINDOW_MS - DAY], now),
      'continue',
    )
  })

  it('keeps walking a short of the cap when a clock is inside', () => {
    assert.equal(classifyHistoryPage(1, 5, [now - DAY], now), 'continue')
  })
})

describe('write and generation gates', () => {
  it('drops a stale generation', () => {
    assert.equal(shouldApplyGeneration(1, 2), false)
    assert.equal(shouldApplyGeneration(2, 2), true)
  })

  it('does not send a second click while the first write is in flight', () => {
    const state = { inFlight: false }
    assert.equal(claimWrite(state), true)
    assert.equal(claimWrite(state), false)
    state.inFlight = false
    assert.equal(claimWrite(state), true)
  })
})

describe('preview refresh', () => {
  it('says the bracket changed when a seeded pair differs', () => {
    const expected = [{ seedKey: '1|4', players: '10|40', heat: 0.2 }]
    assert.equal(bracketChanged(expected, expected), false)
    assert.equal(
      bracketChanged(expected, [{ seedKey: '1|4', players: '10|30', heat: 0.2 }]),
      true,
    )
  })
})

describe('seed join', () => {
  it('fills a missing slot seed from the entrant', () => {
    const seeds: SeedSlot[] = [
      {
        seedId: 's1',
        seedNum: 4,
        entrantId: 'e4',
        playerId: '40',
        gamerTag: 'D',
        participantCount: 1,
      },
    ]
    const sets: PhaseSet[] = [
      {
        id: 'set1',
        state: 1,
        round: 1,
        fullRoundText: 'Winners Round 1',
        winnerId: null,
        hasReportedGames: false,
        slots: [
          {
            slotIndex: 1,
            seedNum: null,
            entrantId: 'e4',
            playerId: '40',
            gamerTag: 'D',
            prereqId: null,
            prereqType: null,
            prereqPlacement: null,
          },
        ],
      },
    ]
    const filled = fillMissingSeedNums(sets, seeds)
    assert.equal(filled[0]?.slots[0]?.seedNum, 4)
  })
})

describe('link', () => {
  it('parses event and bracket links', () => {
    const event = resolveStartGgLink(
      'https://www.start.gg/tournament/weeknight-42/event/singles/',
    )
    assert.deepEqual(event, {
      kind: 'event',
      tournamentSlug: 'weeknight-42',
      eventSlug: 'singles',
    })
    const bracket = resolveStartGgLink(
      'https://start.gg/tournament/weeknight-42/event/singles/brackets/123456/0',
    )
    assert.deepEqual(bracket, { kind: 'bracket', phaseId: '123456' })
  })
})

function phaseSeed(n: number, playerId: string, tag: string): SeedSlot {
  return {
    seedId: `s${n}`,
    seedNum: n,
    entrantId: `e${n}`,
    playerId,
    gamerTag: tag,
    participantCount: 1,
  }
}

function phaseSlot(
  partial: Partial<PhaseSet['slots'][number]> & Pick<PhaseSet['slots'][number], 'slotIndex'>,
): PhaseSet['slots'][number] {
  return {
    seedNum: null,
    entrantId: null,
    playerId: null,
    gamerTag: null,
    prereqId: null,
    prereqType: null,
    prereqPlacement: null,
    ...partial,
  }
}

function phaseSet(
  id: string,
  fullRoundText: string,
  slots: PhaseSet['slots'],
  winnerId: string | null = null,
): PhaseSet {
  return {
    id,
    state: 1,
    round: null,
    fullRoundText,
    winnerId,
    hasReportedGames: false,
    slots,
  }
}

describe('projected bracket', () => {
  const seeds = [
    phaseSeed(1, '10', 'A'),
    phaseSeed(2, '20', 'B'),
    phaseSeed(3, '30', 'C'),
    phaseSeed(4, '40', 'D'),
  ]
  const winners = [
    phaseSet('w1', 'Winners Round 1', [
      phaseSlot({ slotIndex: 1, seedNum: 1, entrantId: 'e1', playerId: '10', gamerTag: 'A' }),
      phaseSlot({ slotIndex: 2, seedNum: 4, entrantId: 'e4', playerId: '40', gamerTag: 'D' }),
    ]),
    phaseSet('w2', 'Winners Round 1', [
      phaseSlot({ slotIndex: 1, seedNum: 2, entrantId: 'e2', playerId: '20', gamerTag: 'B' }),
      phaseSlot({ slotIndex: 2, seedNum: 3, entrantId: 'e3', playerId: '30', gamerTag: 'C' }),
    ]),
  ]
  const final = phaseSet('wf', 'Winners Final', [
    phaseSlot({ slotIndex: 1, prereqId: 'w1', prereqType: 'set', prereqPlacement: 1 }),
    phaseSlot({ slotIndex: 2, prereqId: 'w2', prereqType: 'set', prereqPlacement: 1 }),
  ])
  const losers = phaseSet('l1', 'Losers Round 1', [
    phaseSlot({ slotIndex: 1, prereqId: 'w1', prereqType: 'set', prereqPlacement: 2 }),
    phaseSlot({ slotIndex: 2, prereqId: 'w2', prereqType: 'set', prereqPlacement: 2 }),
  ])

  function ids(sets: PhaseSet[], id: string): string[] {
    const row = projectBracket(sets, seeds).find((item) => item.set.id === id)
    assert.ok(row)
    return projectedPlayerIds(row.slots)
  }

  it('advances the better seed and keeps an actual winner', () => {
    const sets = [...winners, final, losers]
    assert.deepEqual(ids(sets, 'wf'), ['10', '20'])
    assert.deepEqual(ids(sets, 'l1'), ['40', '30'])
    const upset = [
      { ...winners[0], winnerId: 'e4' },
      winners[1],
      final,
    ]
    assert.deepEqual(ids(upset, 'wf'), ['40', '20'])
    const pairs = buildPairList(sets, seeds).map((pair) => pairKey(pair.a, pair.b))
    assert.ok(pairs.includes('10|20'))
    assert.ok(pairs.includes('30|40'))
  })

  it('labels the forecast and leaves byes, gaps, cycles, and resets empty', () => {
    const sets = [...winners, final]
    const projected = projectBracket(sets, seeds)
    assert.equal(projected.find((row) => row.set.id === 'w1')?.projected, false)
    assert.equal(projected.find((row) => row.set.id === 'wf')?.projected, true)

    const bye = phaseSet('bye', 'Winners Round 1', [
      phaseSlot({ slotIndex: 1, seedNum: 1, entrantId: 'e1', playerId: '10', gamerTag: 'A' }),
      phaseSlot({ slotIndex: 2 }),
    ])
    const afterBye = phaseSet('after-bye', 'Winners Quarter-Final', [
      phaseSlot({ slotIndex: 1, prereqId: 'bye', prereqType: 'set', prereqPlacement: 1 }),
      phaseSlot({ slotIndex: 2, seedNum: 2, entrantId: 'e2', playerId: '20', gamerTag: 'B' }),
    ])
    const byeRows = projectBracket([bye, afterBye], seeds)
    assert.equal(byeRows[0]?.scoreable, false)
    assert.equal(isByeSet(byeRows[0]?.slots ?? []), true)
    assert.deepEqual(projectedPlayerIds(byeRows[1]?.slots ?? []), ['10', '20'])

    const missing = phaseSet('missing', 'Winners Final', [
      phaseSlot({ slotIndex: 1, prereqId: 'gone', prereqType: 'set', prereqPlacement: 1 }),
      phaseSlot({ slotIndex: 2, prereqId: 'w1', prereqType: 'set', prereqPlacement: 1 }),
    ])
    const missingRow = projectBracket([...winners, missing], seeds).find((row) => row.set.id === 'missing')
    assert.equal(missingRow?.scoreable, false)
    assert.equal(missingRow?.slots[0]?.kind, 'bye')
    assert.equal(isByeSet(missingRow?.slots ?? []), true)

    const losersBye = phaseSet('lb', 'Losers Round 1', [
      phaseSlot({ slotIndex: 1, prereqId: 'w1', prereqType: 'set', prereqPlacement: 2 }),
      phaseSlot({ slotIndex: 2, prereqId: 'omitted-bye', prereqType: 'set', prereqPlacement: 1 }),
    ])
    const losersNext = phaseSet('ln', 'Losers Round 2', [
      phaseSlot({ slotIndex: 1, prereqId: 'lb', prereqType: 'set', prereqPlacement: 1 }),
      phaseSlot({ slotIndex: 2, seedNum: 2, entrantId: 'e2', playerId: '20', gamerTag: 'B' }),
    ])
    const passed = projectBracket([...winners, losersBye, losersNext], seeds)
    const byeRow = passed.find((row) => row.set.id === 'lb')
    const nextRow = passed.find((row) => row.set.id === 'ln')
    assert.equal(isByeSet(byeRow?.slots ?? []), true)
    assert.deepEqual(projectedPlayerIds(nextRow?.slots ?? []), ['40', '20'])

    const doubleBye = phaseSet('bb', 'Losers Round 2', [
      phaseSlot({ slotIndex: 1, prereqId: 'omit-a', prereqType: 'set', prereqPlacement: 1 }),
      phaseSlot({ slotIndex: 2, prereqId: 'omit-b', prereqType: 'set', prereqPlacement: 1 }),
    ])
    const afterDouble = phaseSet('lr3', 'Losers Round 3', [
      phaseSlot({ slotIndex: 1, seedNum: 1, entrantId: 'e1', playerId: '10', gamerTag: 'A' }),
      phaseSlot({ slotIndex: 2, prereqId: 'bb', prereqType: 'set', prereqPlacement: 1 }),
    ])
    const real = phaseSet('lr4', 'Losers Round 4', [
      phaseSlot({ slotIndex: 1, prereqId: 'lr3', prereqType: 'set', prereqPlacement: 1 }),
      phaseSlot({ slotIndex: 2, seedNum: 2, entrantId: 'e2', playerId: '20', gamerTag: 'B' }),
    ])
    const chain = projectBracket([doubleBye, afterDouble, real], seeds)
    assert.equal(isByeSet(chain.find((row) => row.set.id === 'bb')?.slots ?? []), true)
    assert.equal(isByeSet(chain.find((row) => row.set.id === 'lr3')?.slots ?? []), true)
    assert.deepEqual(
      projectedPlayerIds(chain.find((row) => row.set.id === 'lr4')?.slots ?? []),
      ['10', '20'],
    )

    const cycle = phaseSet('cycle', 'Winners Final', [
      phaseSlot({ slotIndex: 1, prereqId: 'cycle', prereqType: 'set', prereqPlacement: 1 }),
      phaseSlot({ slotIndex: 2, prereqId: 'cycle', prereqType: 'set', prereqPlacement: 2 }),
    ])
    const cycleRow = projectBracket([cycle], seeds)[0]
    assert.equal(cycleRow?.scoreable, false)
    assert.ok(cycleRow?.slots.every((slot) => slot.kind === 'unresolved'))

    const reset = phaseSet('reset', 'Grand Final Reset', [
      phaseSlot({ slotIndex: 1, prereqId: 'wf', prereqType: 'set', prereqPlacement: 1 }),
      phaseSlot({ slotIndex: 2, prereqId: 'wf', prereqType: 'set', prereqPlacement: 2 }),
    ])
    const resetRow = projectBracket([...sets, reset], seeds).find((row) => row.set.id === 'reset')
    assert.equal(resetRow?.scoreable, false)
    assert.ok(resetRow?.slots.every((slot) => slot.kind === 'unresolved'))
  })

  it('keeps bye winners seated when start.gg did not create the earlier set', () => {
    const collapsed = phaseSet('wr2', 'Winners Round 2', [
      phaseSlot({
        slotIndex: 1,
        seedNum: 1,
        entrantId: 'e1',
        playerId: '10',
        gamerTag: 'A',
        prereqId: 'preview-missing-a',
        prereqType: 'set',
        prereqPlacement: 1,
      }),
      phaseSlot({
        slotIndex: 2,
        seedNum: 4,
        entrantId: 'e4',
        playerId: '40',
        gamerTag: 'D',
        prereqId: 'preview-missing-b',
        prereqType: 'set',
        prereqPlacement: 1,
      }),
    ])
    const row = projectBracket([collapsed], seeds)[0]
    assert.equal(row?.scoreable, true)
    assert.deepEqual(projectedPlayerIds(row?.slots ?? []), ['10', '40'])
  })
})

describe('focused moves', () => {
  const seeds = [
    phaseSeed(1, '10', 'A'),
    phaseSeed(2, '20', 'B'),
    phaseSeed(3, '30', 'C'),
    phaseSeed(4, '40', 'D'),
  ]
  const sets = [
    phaseSet('r1a', 'Winners Round 1', [
      phaseSlot({ slotIndex: 1, seedNum: 1, entrantId: 'e1', playerId: '10', gamerTag: 'A' }),
      phaseSlot({ slotIndex: 2, seedNum: 4, entrantId: 'e4', playerId: '40', gamerTag: 'D' }),
    ]),
    phaseSet('r1b', 'Winners Round 1', [
      phaseSlot({ slotIndex: 1, seedNum: 2, entrantId: 'e2', playerId: '20', gamerTag: 'B' }),
      phaseSlot({ slotIndex: 2, seedNum: 3, entrantId: 'e3', playerId: '30', gamerTag: 'C' }),
    ]),
    phaseSet('wf', 'Winners Final', [
      phaseSlot({ slotIndex: 1, prereqId: 'r1a', prereqType: 'set', prereqPlacement: 1 }),
      phaseSlot({ slotIndex: 2, prereqId: 'r1b', prereqType: 'set', prereqPlacement: 1 }),
    ]),
  ]
  const days = new Map<string, number>([
    ['10|20', 1],
    ['10|30', 50],
    ['10|40', 50],
    ['20|30', 50],
    ['20|40', 50],
    ['30|40', 50],
  ])

  function movesFor(focusSetId: string | null) {
    return listSuggestedMoves({
      seeds,
      sets,
      daysByPair: days,
      focusSetId,
      pairHeat: (a, b) => {
        const key = pairKey(a, b)
        if (!days.has(key)) return { missing: true }
        return { ok: true, heat: computeHeat(days.get(key)!, 1) }
      },
    })
  }

  it('cools the selected set and rejects a move that heats another', () => {
    const moves = movesFor('wf')
    assert.ok(moves.some((move) => move.id === '2->3'))
    assert.ok(!moves.some((move) => move.id === '2->4'))
  })

  it('keeps a move whose new heat on another set stays below this set', () => {
    const seeds = [
      phaseSeed(1, '10', 'A'),
      phaseSeed(2, '20', 'B'),
      phaseSeed(3, '30', 'C'),
      phaseSeed(4, '40', 'D'),
    ]
    const sets = [
      phaseSet('focus', 'Winners Round 1', [
        phaseSlot({ slotIndex: 1, seedNum: 1, entrantId: 'e1', playerId: '10', gamerTag: 'A' }),
        phaseSlot({ slotIndex: 2, seedNum: 2, entrantId: 'e2', playerId: '20', gamerTag: 'B' }),
      ]),
      phaseSet('other', 'Winners Round 1', [
        phaseSlot({ slotIndex: 1, seedNum: 3, entrantId: 'e3', playerId: '30', gamerTag: 'C' }),
        phaseSlot({ slotIndex: 2, seedNum: 4, entrantId: 'e4', playerId: '40', gamerTag: 'D' }),
      ]),
    ]
    const heatByPair = new Map<string, number>([
      ['10|20', 0.5],
      ['10|40', 0.1],
      ['20|30', 0.2],
      ['20|40', 0.6],
    ])
    const moves = listSuggestedMoves({
      seeds,
      sets,
      daysByPair: new Map(),
      focusSetId: 'focus',
      pairHeat: (a, b) => {
        const heat = heatByPair.get(pairKey(a, b))
        if (heat == null) return { missing: true }
        return { ok: true, heat }
      },
    })
    assert.ok(moves.some((move) => move.id === '4->2'))
    assert.ok(!moves.some((move) => move.id === '2->4'))
    const kept = moves.find((move) => move.id === '4->2')
    assert.ok(kept)
    assert.ok(kept.setHeatAfter != null && kept.setHeatAfter < 0.5)
    assert.ok(kept.newHottest < 0.5)
  })

  it('hides suggestions until a set is selected', () => {
    assert.deepEqual(movesForSelectedSet(null, movesFor('wf')), [])
    assert.ok(movesForSelectedSet('wf', movesFor('wf')).length > 0)
  })

  it('names this set’s drop apart from the heat left on the bracket', () => {
    const seeds = [
      phaseSeed(1, '10', 'A'),
      phaseSeed(2, '20', 'B'),
      phaseSeed(3, '30', 'C'),
      phaseSeed(4, '40', 'D'),
    ]
    const sets = [
      phaseSet('hot', 'Winners Round 1', [
        phaseSlot({ slotIndex: 1, seedNum: 1, entrantId: 'e1', playerId: '10', gamerTag: 'A' }),
        phaseSlot({ slotIndex: 2, seedNum: 4, entrantId: 'e4', playerId: '40', gamerTag: 'D' }),
      ]),
      phaseSet('other', 'Winners Round 1', [
        phaseSlot({ slotIndex: 1, seedNum: 2, entrantId: 'e2', playerId: '20', gamerTag: 'B' }),
        phaseSlot({ slotIndex: 2, seedNum: 3, entrantId: 'e3', playerId: '30', gamerTag: 'C' }),
      ]),
      phaseSet('final', 'Winners Final', [
        phaseSlot({ slotIndex: 1, prereqId: 'hot', prereqType: 'set', prereqPlacement: 1 }),
        phaseSlot({ slotIndex: 2, prereqId: 'other', prereqType: 'set', prereqPlacement: 1 }),
      ]),
    ]
    const days = new Map<string, number>([
      ['10|40', 1],
      ['10|20', 3],
    ])
    const moves = listSuggestedMoves({
      seeds,
      sets,
      daysByPair: days,
      focusSetId: 'hot',
      pairHeat: (a, b) => {
        const key = pairKey(a, b)
        if (!days.has(key)) return { missing: true }
        return { ok: true, heat: computeHeat(days.get(key)!, 1) }
      },
    })
    const kept = moves.find((move) => move.id === '4->3' || move.id === '3->4')
    assert.ok(kept)
    assert.equal(
      moves.filter((move) => move.id === '4->3' || move.id === '3->4').length,
      1,
    )
    assert.ok(kept.setHeatBefore != null && kept.setHeatAfter != null)
    assert.ok(kept.setHeatAfter < kept.setHeatBefore)
    assert.ok(kept.newHottest > kept.setHeatAfter)
    const line = describeSuggestedMove(kept)
    assert.match(line, /Swap C \(seed 3\) with D \(seed 4\)/)
    assert.match(line, /This set \d\.\d{3} → \d\.\d{3}/)
    assert.equal(line.includes('Hottest'), false)
    assert.equal(
      describeSuggestedMove({
        entrantTag: 'Yip',
        seedNumFrom: 22,
        seedNumTo: 24,
        shift: 2,
        shifted: [
          { tag: 'Finnmacbo', seedNumFrom: 23, seedNumTo: 22 },
          { tag: 'Acgamer28', seedNumFrom: 24, seedNumTo: 23 },
        ],
        setHeatBefore: 0.331,
        setHeatAfter: 0,
      } as SuggestedMove),
      'Move Yip (seed 22) to seed 24. Finnmacbo (seed 23) moves to seed 22, and Acgamer28 (seed 24) moves to seed 23. This set 0.331 → 0.000.',
    )
    assert.match(
      describeMovesCard(moves),
      /Hottest heat left on the bracket is \d\.\d{3} to \d\.\d{3}, depending on the move/,
    )
    assert.match(
      describeMovesCard([kept]),
      new RegExp(`Hottest heat left on the bracket: ${kept.newHottest.toFixed(3)}`),
    )
  })
})

describe('placement tiers', () => {
  it('cuts double elim at 17th and 25th', () => {
    assert.equal(tiedPlace('double', 24), 17)
    assert.equal(tiedPlace('double', 25), 25)
    assert.equal(
      placementDropNote('DOUBLE_ELIMINATION', 'Acgamer28', 24, 25),
      'Acgamer28 would be tied for 25th instead of tied for 17th.',
    )
    assert.equal(placementDropNote('DOUBLE_ELIMINATION', 'Acgamer28', 25, 24), null)
    assert.equal(placementDropNote('DOUBLE_ELIMINATION', 'Finnmacbo', 23, 24), null)
  })

  it('keeps seeds 24 and 25 in the same single-elim tier', () => {
    assert.equal(tiedPlace('single', 24), 17)
    assert.equal(tiedPlace('single', 25), 17)
    assert.equal(placementDropNote('SINGLE_ELIMINATION', 'Acgamer28', 24, 25), null)
    assert.equal(
      placementDropNote('SINGLE_ELIMINATION', 'Ween', 8, 9),
      'Ween would be tied for 9th instead of tied for 5th.',
    )
  })

  it('names a unique place without calling it a tie', () => {
    assert.equal(
      placementDropNote('DOUBLE_ELIMINATION', 'Sprinkle', 4, 5),
      'Sprinkle would be tied for 5th instead of 4th.',
    )
  })

  it('stays quiet for a format without seed placement tiers', () => {
    assert.equal(placementDropNote('ROUND_ROBIN', 'Acgamer28', 24, 25), null)
    assert.equal(placementDropNote(null, 'Acgamer28', 24, 25), null)
  })

  it('puts the drop on the suggestion that crosses a double-elim tier', () => {
    const seeds = [
      phaseSeed(1, '10', 'A'),
      phaseSeed(2, '20', 'B'),
      phaseSeed(3, '30', 'C'),
      phaseSeed(4, '40', 'D'),
    ]
    const sets = [
      phaseSet('hot', 'Winners Round 1', [
        phaseSlot({ slotIndex: 1, seedNum: 1, entrantId: 'e1', playerId: '10', gamerTag: 'A' }),
        phaseSlot({ slotIndex: 2, seedNum: 4, entrantId: 'e4', playerId: '40', gamerTag: 'D' }),
      ]),
    ]
    const moves = listSuggestedMoves({
      seeds,
      sets,
      daysByPair: new Map([['10|40', 1]]),
      focusSetId: 'hot',
      bracketType: 'DOUBLE_ELIMINATION',
      pairHeat: (a, b) => {
        if (pairKey(a, b) === '10|40') return { ok: true, heat: 1 }
        return { missing: true }
      },
    })
    const notes = moves.flatMap((move) => move.placementNotes)
    assert.ok(notes.includes('C would be 4th instead of 3rd.'))
    assert.equal(notes.some((note) => note.startsWith('D would be')), false)
  })
})

describe('receipt links', () => {
  it('opens the set for a bare slug and a prefixed slug', () => {
    const expected =
      'https://www.start.gg/tournament/gould-st-gauntlet-26/event/ultimate-singles/set/108084622'
    assert.equal(
      receiptSetUrl('gould-st-gauntlet-26', 'ultimate-singles', '108084622'),
      expected,
    )
    assert.equal(
      receiptSetUrl(
        'tournament/gould-st-gauntlet-26',
        'tournament/gould-st-gauntlet-26/event/ultimate-singles',
        '108084622',
      ),
      expected,
    )
  })

  it('shows the tournament beside the event', () => {
    assert.equal(
      receiptHeading('Gould St Gauntlet 26', 'Ultimate Singles'),
      'Gould St Gauntlet 26 · Ultimate Singles',
    )
  })
})
