import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { receiptSetUrl } from '../src/lib/rematch/receipt.ts'
import { fetchPairHistory } from '../src/lib/startgg/load.ts'
import type { StartGgClient } from '../src/lib/startgg/client.ts'

const DAY_MS = 86_400_000
const NOW_MS = Date.UTC(2026, 9, 20, 15, 0, 0)

function secondsAgo(days: number): number {
  return Math.floor((NOW_MS - days * DAY_MS) / 1000)
}

function clientReturning(node: Record<string, unknown> | null): StartGgClient {
  return {
    async request(_query: string, variables?: Record<string, unknown>) {
      const state = variables?.state
      const completedLookup = Array.isArray(state) && state.length === 1 && state[0] === 3
      return {
        player: {
          id: String(variables?.playerId ?? ''),
          sets: { nodes: completedLookup && node ? [node] : [] },
        },
      }
    },
  } as unknown as StartGgClient
}

function clientReturningNodes(nodes: Array<Record<string, unknown>>): StartGgClient {
  return {
    async request(_query: string, variables?: Record<string, unknown>) {
      const state = variables?.state
      const completedLookup = Array.isArray(state) && state.length === 1 && state[0] === 3
      return {
        player: {
          id: String(variables?.playerId ?? ''),
          sets: { nodes: completedLookup ? nodes : [] },
        },
      }
    },
  } as unknown as StartGgClient
}

function meeting(
  completedAt: number | null,
  startAt: number | null,
  extra?: { id?: string; eventId?: string; eventName?: string },
) {
  return {
    id: extra?.id ?? '108632513',
    state: 3,
    completedAt,
    startedAt: null,
    fullRoundText: 'Winners Quarter-Final',
    winnerId: 'e1',
    event: {
      id: extra?.eventId ?? 'event-1',
      name: extra?.eventName ?? 'Ultimate Singles',
      slug: 'tournament/gould-st-gauntlet-27/event/ultimate-singles',
      startAt,
      tournament: { slug: 'gould-st-gauntlet-27' },
    },
    slots: [
      {
        entrant: {
          id: 'e1',
          participants: [{ gamerTag: 'BrokenSink', player: { id: '1744096' } }],
        },
      },
      {
        entrant: {
          id: 'e2',
          participants: [{ gamerTag: 'SKPeter', player: { id: '175453' } }],
        },
      },
    ],
  }
}

describe('start.gg history clocks', () => {
  // Regression: ISSUE-001 — settled rematches showed no heat
  // Found by /qa on 2026-10-20
  // Report: .gstack/qa-reports/qa-report-skpeter-github-io-2026-10-20.md
  it('counts a meeting whose completedAt is unix seconds inside 60 days', async () => {
    const result = await fetchPairHistory(
      clientReturning(meeting(secondsAgo(13), secondsAgo(13))),
      '1744096',
      '175453',
      NOW_MS,
      'UTC',
    )
    assert.equal(result.kind, 'heat')
    if (result.kind !== 'heat') return
    assert.ok(Math.abs(result.heatDays - 13) < 0.01)
    assert.equal(result.receipt.eventName, 'Ultimate Singles')
    assert.equal(result.receipt.fromCompleted, true)
  })

  it('counts event.startAt in unix seconds when completedAt is missing', async () => {
    const result = await fetchPairHistory(
      clientReturning(meeting(null, secondsAgo(13))),
      '1744096',
      '175453',
      NOW_MS,
      'UTC',
    )
    assert.equal(result.kind, 'heat')
    if (result.kind !== 'heat') return
    assert.ok(Math.abs(result.heatDays - 13) < 0.01)
  })

  it('keeps the prior meeting when a later event is newer', async () => {
    const asOf = NOW_MS - 13 * DAY_MS
    const later = meeting(
      Math.floor((NOW_MS - 2 * DAY_MS) / 1000),
      Math.floor((NOW_MS - 2 * DAY_MS) / 1000),
      { id: 'later-set', eventId: 'later-event', eventName: 'Later Weekly' },
    )
    const prior = meeting(
      Math.floor((asOf - 10 * DAY_MS) / 1000),
      Math.floor((asOf - 10 * DAY_MS) / 1000),
      { id: 'prior-set', eventId: 'prior-event', eventName: 'Prior Weekly' },
    )
    const result = await fetchPairHistory(
      clientReturningNodes([later, prior]),
      '1744096',
      '175453',
      asOf,
      'UTC',
    )
    assert.equal(result.kind, 'heat')
    if (result.kind !== 'heat') return
    assert.equal(result.receipt.eventName, 'Prior Weekly')
    assert.ok(Math.abs(result.heatDays - 10) < 0.01)
  })

  it('does not treat the loaded event as a prior meeting', async () => {
    const asOf = NOW_MS - 13 * DAY_MS
    const itself = meeting(
      Math.floor((asOf - DAY_MS) / 1000),
      Math.floor(asOf / 1000),
      { id: 'self-set', eventId: 'this-event', eventName: 'This Event' },
    )
    const result = await fetchPairHistory(
      clientReturningNodes([itself]),
      '1744096',
      '175453',
      asOf,
      'UTC',
      undefined,
      'this-event',
    )
    assert.equal(result.kind, 'cold')
  })

  it('keeps the tournament name and a direct set link when the slug is prefixed', async () => {
    const node = meeting(secondsAgo(13), secondsAgo(13), { id: '108084622' })
    node.event.slug = 'tournament/gould-st-gauntlet-26/event/ultimate-singles'
    node.event.tournament = {
      slug: 'tournament/gould-st-gauntlet-26',
      name: 'Gould St Gauntlet 26',
    }
    const result = await fetchPairHistory(
      clientReturning(node),
      '1744096',
      '175453',
      NOW_MS,
      'UTC',
    )
    assert.equal(result.kind, 'heat')
    if (result.kind !== 'heat') return
    assert.equal(result.receipt.tournamentName, 'Gould St Gauntlet 26')
    assert.equal(result.receipt.tournamentSlug, 'gould-st-gauntlet-26')
    assert.equal(result.receipt.eventSlug, 'ultimate-singles')
    assert.equal(
      receiptSetUrl(
        result.receipt.tournamentSlug,
        result.receipt.eventSlug,
        result.receipt.setId,
      ),
      'https://www.start.gg/tournament/gould-st-gauntlet-26/event/ultimate-singles/set/108084622',
    )
  })

  it('drops a meeting older than 60 days even when the clock is unix seconds', async () => {
    const result = await fetchPairHistory(
      clientReturning(meeting(secondsAgo(90), secondsAgo(90))),
      '1744096',
      '175453',
      NOW_MS,
      'UTC',
    )
    assert.equal(result.kind, 'cold')
  })
})
