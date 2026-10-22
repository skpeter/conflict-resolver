import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  benchmarkHistoryTransports,
  buildAliasQuery,
  chooseHistoryTransport,
} from '../src/lib/startgg/historyBenchmark.ts'
import type { StartGgClient } from '../src/lib/startgg/client.ts'

const DAY_MS = 86_400_000
const NOW_MS = Date.UTC(2026, 9, 20, 15, 0, 0)

function meeting() {
  const clock = Math.floor((NOW_MS - 10 * DAY_MS) / 1000)
  return {
    id: '108084622',
    state: 3,
    completedAt: clock,
    startedAt: null,
    fullRoundText: 'Winners Final',
    winnerId: 'e1',
    event: {
      id: 'event-1',
      name: 'Ultimate Singles',
      slug: 'tournament/gould-st-gauntlet-26/event/ultimate-singles',
      startAt: clock,
      tournament: { slug: 'tournament/gould-st-gauntlet-26', name: 'Gould St Gauntlet 26' },
    },
    slots: [
      {
        entrant: {
          id: 'e1',
          participants: [{ gamerTag: 'A', player: { id: '10' } }],
        },
      },
      {
        entrant: {
          id: 'e2',
          participants: [{ gamerTag: 'B', player: { id: '20' } }],
        },
      },
    ],
  }
}

function client(): StartGgClient {
  return {
    async request(query: string, variables?: Record<string, unknown>) {
      if (query.includes('AliasHeadToHead')) {
        const data: Record<string, unknown> = {}
        for (let i = 0; i < 8; i += 1) {
          if (variables?.[`p${i}`] == null) break
          data[`h${i}`] = { sets: { nodes: [meeting()] } }
        }
        return data
      }
      return { player: { sets: { nodes: [meeting()] } } }
    },
  } as unknown as StartGgClient
}

describe('history transport benchmark', () => {
  const pairs = [
    { a: '10', b: '20' },
    { a: '30', b: '40' },
  ]

  it('builds a bounded alias query', () => {
    const query = buildAliasQuery(2)
    assert.match(query, /h0:/)
    assert.match(query, /h1:/)
    assert.doesNotMatch(query, /h2:/)
    assert.match(query, /perPage: 100/)
  })

  it('keeps the baseline until a live run confirms a faster equivalent transport', async () => {
    const reports = await benchmarkHistoryTransports(client(), pairs, NOW_MS, 'UTC')
    const baseline = reports.find((report) => report.transport === 'baseline')
    const wide = reports.find((report) => report.transport === 'wide-page')
    const alias = reports.find((report) => report.transport === 'alias-batch')
    assert.ok(baseline && wide && alias)
    assert.equal(baseline.errors, 0)
    assert.equal(wide.errors, 0)
    assert.equal(alias.errors, 0)
    assert.deepEqual(wide.receipts, baseline.receipts)
    assert.deepEqual(alias.receipts, baseline.receipts)
    assert.ok(baseline.calls > wide.calls)
    assert.ok(wide.calls > alias.calls)
    assert.ok(baseline.requestBytes > 0)
    assert.ok(baseline.responseBytes > 0)
    assert.equal(
      chooseHistoryTransport(reports, { liveConfirmed: false }),
      'baseline',
    )
    assert.equal(
      chooseHistoryTransport(reports, { liveConfirmed: true }),
      'alias-batch',
    )
  })

  it('splits an alias batch that would return more than 1000 objects', async () => {
    const heavy = {
      async request(query: string) {
        if (query.includes('AliasHeadToHead') && query.includes('h3:')) {
          throw new Error(
            'Your query complexity is too high. A maximum of 1000 objects may be returned by each request. (actual: 1084)',
          )
        }
        if (query.includes('AliasHeadToHead')) {
          const data: Record<string, unknown> = {}
          const count = query.includes('h1:') ? 2 : 1
          for (let i = 0; i < count; i += 1) {
            data[`h${i}`] = { sets: { nodes: [meeting()] } }
          }
          return data
        }
        return { player: { sets: { nodes: [meeting()] } } }
      },
    } as unknown as StartGgClient
    const four = [
      { a: '10', b: '20' },
      { a: '30', b: '40' },
      { a: '50', b: '60' },
      { a: '70', b: '80' },
    ]
    const reports = await benchmarkHistoryTransports(heavy, four, NOW_MS, 'UTC')
    const wide = reports.find((report) => report.transport === 'wide-page')
    const alias = reports.find((report) => report.transport === 'alias-batch')
    assert.ok(wide && alias)
    assert.equal(alias.errors, 0)
    assert.equal(alias.calls, 3)
    assert.ok(alias.calls < wide.calls)
    assert.deepEqual(alias.receipts, wide.receipts)
  })
})
