import {
  HISTORY_MAX_PAGES,
  classifyHistoryPage,
  orderedPlayerIds,
  pairKey,
  setClock,
} from '../rematch/index.ts'
import type { HistorySet } from '../rematch/types.ts'
import { StartGgClient, isQueryComplexityError } from './client.ts'
import {
  fetchPairHistory,
  mapHistorySet,
  receiptFromHistorySets,
  type H2HNode,
  type PairHistoryResult,
} from './load.ts'
import { HISTORY_SET_FIELDS } from './queries.ts'

export const WIDE_PAGE_SIZE = 100
export const ALIAS_BATCH_SIZE = 8

export type HistoryTransport = 'baseline' | 'wide-page' | 'alias-batch'

export type TransportReport = {
  transport: HistoryTransport
  calls: number
  requestBytes: number
  responseBytes: number
  errors: number
  elapsedMs: number
  receipts: Record<string, string>
}

type Pair = { a: string; b: string }

/**
 * Pick a transport only when a live bracket returned the same receipts in
 * fewer calls. Alias batches start at 8 pairs and split in half when start.gg
 * rejects the response for containing more than 1000 objects. St. George
 * Scramble 104 on 2026-10-21 (37 seeds, 146 pairs) matched the 146-call
 * wide-page receipts in 25 calls.
 */
export function chooseHistoryTransport(
  reports: TransportReport[],
  options: { liveConfirmed: boolean },
): HistoryTransport {
  const baseline = reports.find((report) => report.transport === 'baseline')
  if (!baseline || !options.liveConfirmed) return 'baseline'
  let best = baseline
  for (const report of reports) {
    if (report === baseline || report.errors > 0) continue
    if (!sameReceipts(report.receipts, baseline.receipts)) continue
    const fewerCalls = report.calls < best.calls
    const fasterTie =
      report.calls === best.calls && report.elapsedMs < best.elapsedMs
    if (fewerCalls || fasterTie) best = report
  }
  return best.transport
}

export function receiptSignature(result: PairHistoryResult): string {
  if (result.kind === 'heat') {
    return `heat:${result.receipt.setId}:${result.receipt.exactDays}`
  }
  if (result.kind === 'cold') return 'cold'
  return `failed:${result.label}`
}

export function buildAliasQuery(count: number): string {
  const defs = ['$page: Int!']
  const fields: string[] = []
  for (let i = 0; i < count; i += 1) {
    defs.push(`$p${i}: ID!`, `$o${i}: ID!`)
    fields.push(`
      h${i}: player(id: $p${i}) {
        sets(page: $page, perPage: ${WIDE_PAGE_SIZE}, opponentId: $o${i}, filters: { state: [2, 3, 4, 6] }) {
          nodes { ${HISTORY_SET_FIELDS} }
        }
      }
    `)
  }
  return `query AliasHeadToHead(${defs.join(', ')}) { ${fields.join('\n')} }`
}

export async function benchmarkHistoryTransports(
  client: StartGgClient,
  pairs: Pair[],
  nowMs: number,
  timeZone: string,
  excludeEventId?: string | null,
  transports: HistoryTransport[] = ['baseline', 'wide-page', 'alias-batch'],
): Promise<TransportReport[]> {
  const reports: TransportReport[] = []
  if (transports.includes('baseline')) {
    reports.push(
      await runTransport('baseline', client, pairs, (watched) =>
        collectPairReceipts(pairs, (pair) =>
          fetchPairHistory(
            watched,
            pair.a,
            pair.b,
            nowMs,
            timeZone,
            undefined,
            excludeEventId,
          ),
        ),
      ),
    )
  }
  if (transports.includes('wide-page')) {
    reports.push(
      await runTransport('wide-page', client, pairs, (watched) =>
        collectPairReceipts(pairs, (pair) =>
          fetchPairHistory(
            watched,
            pair.a,
            pair.b,
            nowMs,
            timeZone,
            undefined,
            excludeEventId,
            { perPage: WIDE_PAGE_SIZE, combineStates: true },
          ),
        ),
      ),
    )
  }
  if (transports.includes('alias-batch')) {
    reports.push(
      await runTransport('alias-batch', client, pairs, (watched) =>
        aliasReceipts(watched, pairs, nowMs, timeZone, excludeEventId),
      ),
    )
  }
  return reports
}

function sameReceipts(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (left[key] !== right[key]) return false
  }
  return true
}

function watch(client: StartGgClient): {
  client: StartGgClient
  snapshot: () => Omit<TransportReport, 'transport' | 'receipts'>
} {
  const metrics = {
    calls: 0,
    requestBytes: 0,
    responseBytes: 0,
    errors: 0,
    elapsedMs: 0,
  }
  const wrapped = {
    async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      metrics.calls += 1
      metrics.requestBytes += JSON.stringify({ query, variables }).length
      const started = performance.now()
      try {
        const data = await client.request<T>(query, variables)
        metrics.responseBytes += JSON.stringify(data).length
        return data
      } catch (err) {
        if (!isQueryComplexityError(err)) metrics.errors += 1
        throw err
      } finally {
        metrics.elapsedMs += performance.now() - started
      }
    },
  }
  return {
    client: wrapped as StartGgClient,
    snapshot: () => ({ ...metrics }),
  }
}

async function runTransport(
  transport: HistoryTransport,
  client: StartGgClient,
  pairs: Pair[],
  run: (client: StartGgClient) => Promise<Record<string, string>>,
): Promise<TransportReport> {
  const watched = watch(client)
  let receipts: Record<string, string> = {}
  try {
    receipts = await run(watched.client)
  } catch {
    receipts = Object.fromEntries(pairs.map((pair) => [pairKey(pair.a, pair.b), 'failed:transport']))
  }
  return { transport, receipts, ...watched.snapshot() }
}

async function collectPairReceipts(
  pairs: Pair[],
  load: (pair: Pair) => Promise<PairHistoryResult>,
): Promise<Record<string, string>> {
  const receipts: Record<string, string> = {}
  for (const pair of pairs) {
    try {
      receipts[pairKey(pair.a, pair.b)] = receiptSignature(await load(pair))
    } catch {
      receipts[pairKey(pair.a, pair.b)] = 'failed:transport'
    }
  }
  return receipts
}

export async function loadAliasPairHistories(
  client: StartGgClient,
  pairs: Pair[],
  nowMs: number,
  timeZone: string,
  excludeEventId?: string | null,
  onPair?: (key: string, result: PairHistoryResult) => void,
): Promise<void> {
  await walkAliasBatches(client, pairs, nowMs, timeZone, excludeEventId, ALIAS_BATCH_SIZE, (key, result) => {
    onPair?.(
      key,
      result === 'transport'
        ? {
            kind: 'history-failed',
            label: 'history failed',
            context: null,
            cache: { completed: null, unfinished: null },
          }
        : result,
    )
  })
}

async function aliasReceipts(
  client: StartGgClient,
  pairs: Pair[],
  nowMs: number,
  timeZone: string,
  excludeEventId?: string | null,
): Promise<Record<string, string>> {
  const receipts: Record<string, string> = {}
  await walkAliasBatches(
    client,
    pairs,
    nowMs,
    timeZone,
    excludeEventId,
    ALIAS_BATCH_SIZE,
    (key, result) => {
      receipts[key] = result === 'transport' ? 'failed:transport' : receiptSignature(result)
    },
  )
  return receipts
}

async function walkAliasBatches(
  client: StartGgClient,
  pairs: Pair[],
  nowMs: number,
  timeZone: string,
  excludeEventId: string | null | undefined,
  batchSize: number,
  onPair: (key: string, result: PairHistoryResult | 'transport') => void,
): Promise<void> {
  for (let offset = 0; offset < pairs.length; offset += batchSize) {
    const batch = pairs.slice(offset, offset + batchSize)
    const collected = batch.map(() => [] as HistorySet[])
    const incomplete = batch.map(() => false)
    const finished = batch.map(() => false)
    const failed = batch.map(() => false)
    for (let page = 1; page <= HISTORY_MAX_PAGES; page += 1) {
      const indexes = finished.flatMap((done, index) => (done ? [] : [index]))
      if (indexes.length === 0) break
      const subset = indexes.map((index) => batch[index])
      let pages: Array<{ sets: HistorySet[]; nodeCount: number }>
      try {
        pages = await fetchAliasPageSplitting(client, subset, page)
      } catch {
        indexes.forEach((index) => {
          failed[index] = true
          finished[index] = true
        })
        continue
      }
      pages.forEach((pageResult, subsetIndex) => {
        const index = indexes[subsetIndex]
        collected[index].push(...pageResult.sets)
        const clocks = pageResult.sets.map((set) => {
          const clock = setClock({
            completedAt: set.completedAt,
            eventStartAt: set.eventStartAt,
          })
          return clock?.clockMs ?? null
        })
        const decision = classifyHistoryPage(
          page,
          pageResult.nodeCount,
          clocks,
          nowMs,
          WIDE_PAGE_SIZE,
        )
        if (decision === 'incomplete') incomplete[index] = true
        if (decision !== 'continue') finished[index] = true
      })
    }
    batch.forEach((pair, index) => {
      const key = pairKey(pair.a, pair.b)
      onPair(
        key,
        failed[index]
          ? 'transport'
          : receiptFromHistorySets(
              collected[index],
              nowMs,
              timeZone,
              excludeEventId,
              incomplete[index],
            ),
      )
    })
  }
}

async function fetchAliasPageSplitting(
  client: StartGgClient,
  pairs: Pair[],
  page: number,
): Promise<Array<{ sets: HistorySet[]; nodeCount: number }>> {
  try {
    return await fetchAliasPage(client, pairs, page)
  } catch (err) {
    if (pairs.length <= 1 || !isQueryComplexityError(err)) throw err
    const mid = Math.ceil(pairs.length / 2)
    const left = await fetchAliasPageSplitting(client, pairs.slice(0, mid), page)
    const right = await fetchAliasPageSplitting(client, pairs.slice(mid), page)
    return [...left, ...right]
  }
}

async function fetchAliasPage(
  client: StartGgClient,
  pairs: Pair[],
  page: number,
): Promise<Array<{ sets: HistorySet[]; nodeCount: number }>> {
  const variables: Record<string, unknown> = { page }
  pairs.forEach((pair, index) => {
    const ordered = orderedPlayerIds(pair.a, pair.b)
    variables[`p${index}`] = ordered.lowerId
    variables[`o${index}`] = ordered.higherId
  })
  const data = await client.request<
    Record<string, { sets: { nodes: H2HNode[] } | null } | null>
  >(buildAliasQuery(pairs.length), variables)
  return pairs.map((_, index) => {
    const nodes = data[`h${index}`]?.sets?.nodes ?? []
    const sets = nodes
      .map((node) => mapHistorySet(node))
      .filter((set): set is HistorySet => set != null)
    return { sets, nodeCount: nodes.length }
  })
}
