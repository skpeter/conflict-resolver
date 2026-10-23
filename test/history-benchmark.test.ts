import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  benchmarkHistoryTransports,
  buildAliasQuery,
  chooseHistoryTransport,
  loadAliasPairHistories,
} from '../src/lib/startgg/historyBenchmark.ts'
import { MAX_RATE_LIMIT_ATTEMPTS, StartGgClient } from '../src/lib/startgg/client.ts'
import { fetchPairHistory } from '../src/lib/startgg/load.ts'

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

  it('treats a null history reply as failed and an empty list as cold', async () => {
    const replies = [
      { h0: null },
      { h0: { sets: null } },
      { h0: { sets: { nodes: [] } } },
    ]
    const seen: string[] = []
    for (const reply of replies) {
      const client = {
        async request() {
          return reply
        },
      } as unknown as StartGgClient
      await loadAliasPairHistories(
        client,
        [{ a: '10', b: '20' }],
        NOW_MS,
        'UTC',
        null,
        (_key, result) => {
          seen.push(result.kind)
        },
      )
    }
    assert.deepEqual(seen, ['history-failed', 'history-failed', 'cold'])
  })

  it('stops before the next page when the load is no longer current', async () => {
    let calls = 0
    let current = true
    const full = Array.from({ length: 100 }, () => meeting())
    const client = {
      async request() {
        calls += 1
        current = false
        return { h0: { sets: { nodes: full } } }
      },
    } as unknown as StartGgClient
    const seen: string[] = []
    await loadAliasPairHistories(
      client,
      [{ a: '10', b: '20' }],
      NOW_MS,
      'UTC',
      null,
      (_key, result) => {
        seen.push(result.kind)
      },
      () => current,
    )
    assert.equal(calls, 1)
    assert.deepEqual(seen, [])
  })

  it('requests the next wide page when the first page is full', async () => {
    let calls = 0
    const client = {
      async request() {
        calls += 1
        const nodes = calls === 1 ? Array.from({ length: 100 }, () => meeting()) : [meeting()]
        return { h0: { sets: { nodes } } }
      },
    } as unknown as StartGgClient
    const seen: string[] = []
    await loadAliasPairHistories(
      client,
      [{ a: '10', b: '20' }],
      NOW_MS,
      'UTC',
      null,
      (_key, result) => {
        seen.push(result.kind)
      },
    )
    assert.equal(calls, 2)
    assert.deepEqual(seen, ['heat'])
  })

  it('does not fetch the next half after the load is replaced', async () => {
    let calls = 0
    let current = true
    const client = {
      async request(query: string) {
        calls += 1
        current = false
        if (query.includes('h1:')) {
          throw new Error(
            'Your query complexity is too high. A maximum of 1000 objects may be returned by each request.',
          )
        }
        return { h0: { sets: { nodes: [meeting()] } } }
      },
    } as unknown as StartGgClient
    await loadAliasPairHistories(
      client,
      [
        { a: '10', b: '20' },
        { a: '30', b: '40' },
      ],
      NOW_MS,
      'UTC',
      null,
      () => {},
      () => current,
    )
    assert.equal(calls, 1)
  })
})

describe('pair history retry', () => {
  it('keeps a null payload failed and an empty page cold', async () => {
    const replies = [
      { player: null },
      { player: { sets: null } },
      { player: { sets: { nodes: null } } },
      { player: { sets: { nodes: [] } } },
    ]
    const seen: string[] = []
    for (const reply of replies) {
      const client = {
        async request() {
          return reply
        },
      } as unknown as StartGgClient
      const result = await fetchPairHistory(
        client,
        '10',
        '20',
        NOW_MS,
        'UTC',
        undefined,
        null,
        { combineStates: true },
      )
      seen.push(result.kind)
    }
    assert.deepEqual(seen, ['history-failed', 'history-failed', 'history-failed', 'cold'])
  })

  it('skips the network when both cached sides are already present', async () => {
    let calls = 0
    const client = {
      async request() {
        calls += 1
        return { player: null }
      },
    } as unknown as StartGgClient
    const result = await fetchPairHistory(
      client,
      '10',
      '20',
      NOW_MS,
      'UTC',
      { completed: [], unfinished: [] },
      null,
      { combineStates: true },
    )
    assert.equal(calls, 0)
    assert.equal(result.kind, 'cold')
  })
})

describe('start.gg client rate limit', () => {
  it('stops a 429 after the attempt cap', async () => {
    const previous = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response('{}', {
        status: 429,
        headers: { 'retry-after': '0' },
      })
    }) as typeof fetch
    try {
      await assert.rejects(new StartGgClient('token').request('query { x }'))
      assert.equal(calls, MAX_RATE_LIMIT_ATTEMPTS)
    } finally {
      globalThis.fetch = previous
    }
  })

  it('does not sleep on a 429 after the load is replaced', async () => {
    const previous = globalThis.fetch
    let calls = 0
    const client = new StartGgClient('token')
    globalThis.fetch = (async () => {
      calls += 1
      client.retire()
      return new Response('{}', {
        status: 429,
        headers: { 'retry-after': '0' },
      })
    }) as typeof fetch
    try {
      await assert.rejects(client.request('query { x }'), /cancelled/)
      assert.equal(calls, 1)
    } finally {
      globalThis.fetch = previous
    }
  })
})
