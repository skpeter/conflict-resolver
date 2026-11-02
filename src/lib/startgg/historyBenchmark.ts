import {
  classifyHistoryPage,
  historyPageLimit,
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

export function buildAliasQuery(count: number, perPage = WIDE_PAGE_SIZE): string {
  const defs = ['$page: Int!']
  const fields: string[] = []
  for (let i = 0; i < count; i += 1) {
    defs.push(`$p${i}: ID!`, `$o${i}: ID!`)
    fields.push(`
      h${i}: player(id: $p${i}) {
        sets(page: $page, perPage: ${perPage}, opponentId: $o${i}, filters: { state: [2, 3, 4, 6] }) {
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
  shouldContinue?: () => boolean,
): Promise<void> {
  await walkAliasBatches(
    client,
    pairs,
    nowMs,
    timeZone,
    excludeEventId,
    ALIAS_BATCH_SIZE,
    (key, result) => {
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
    },
    shouldContinue,
  )
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

type AliasPage = {
  sets: HistorySet[]
  nodeCount: number
  missing: boolean
  pageSize: number
}

async function walkAliasBatches(
  client: StartGgClient,
  pairs: Pair[],
  nowMs: number,
  timeZone: string,
  excludeEventId: string | null | undefined,
  batchSize: number,
  onPair: (key: string, result: PairHistoryResult | 'transport') => void,
  shouldContinue?: () => boolean,
): Promise<void> {
  const current = () => shouldContinue?.() !== false
  for (let offset = 0; offset < pairs.length; offset += batchSize) {
    if (!current()) return
    const batch = pairs.slice(offset, offset + batchSize)
    const slots = batch.map(() => ({
      sets: [] as HistorySet[],
      incomplete: false,
      finished: false,
      failed: false,
      pageSize: WIDE_PAGE_SIZE,
      nextPage: 1,
    }))
    while (slots.some((slot) => !slot.finished)) {
      if (!current()) return
      const groups = new Map<string, number[]>()
      slots.forEach((slot, index) => {
        if (slot.finished) return
        const key = `${slot.pageSize}:${slot.nextPage}`
        const indexes = groups.get(key) ?? []
        indexes.push(index)
        groups.set(key, indexes)
      })
      for (const indexes of groups.values()) {
        if (!current()) return
        const first = slots[indexes[0]]
        let pages: AliasPage[]
        try {
          pages = await fetchAliasPageSplitting(
            client,
            indexes.map((index) => batch[index]),
            first.nextPage,
            first.pageSize,
            current,
          )
        } catch {
          for (const index of indexes) {
            slots[index].failed = true
            slots[index].finished = true
          }
          continue
        }
        pages.forEach((pageResult, subsetIndex) => {
          const slot = slots[indexes[subsetIndex]]
          if (pageResult.missing) {
            slot.failed = true
            slot.finished = true
            return
          }
          slot.pageSize = pageResult.pageSize
          slot.sets.push(...pageResult.sets)
          const clocks = pageResult.sets.map((set) => {
            const clock = setClock({
              completedAt: set.completedAt,
              eventStartAt: set.eventStartAt,
            })
            return clock?.clockMs ?? null
          })
          const maxPages = historyPageLimit(slot.pageSize, WIDE_PAGE_SIZE)
          const decision = classifyHistoryPage(
            slot.nextPage,
            pageResult.nodeCount,
            clocks,
            nowMs,
            slot.pageSize,
            maxPages,
          )
          if (decision === 'incomplete') slot.incomplete = true
          if (decision === 'continue') slot.nextPage += 1
          else slot.finished = true
        })
      }
    }
    if (!current()) return
    batch.forEach((pair, index) => {
      const slot = slots[index]
      onPair(
        pairKey(pair.a, pair.b),
        slot.failed
          ? 'transport'
          : receiptFromHistorySets(
              slot.sets,
              nowMs,
              timeZone,
              excludeEventId,
              slot.incomplete,
            ),
      )
    })
  }
}

async function fetchAliasPageSplitting(
  client: StartGgClient,
  pairs: Pair[],
  page: number,
  perPage: number,
  shouldContinue?: () => boolean,
): Promise<AliasPage[]> {
  try {
    const pages = await fetchAliasPage(client, pairs, page, perPage)
    return pages.map((result) => ({ ...result, pageSize: perPage }))
  } catch (err) {
    if (shouldContinue && !shouldContinue()) throw err
    if (!isQueryComplexityError(err)) throw err
    if (pairs.length > 1) {
      const mid = Math.ceil(pairs.length / 2)
      const left = await fetchAliasPageSplitting(
        client,
        pairs.slice(0, mid),
        page,
        perPage,
        shouldContinue,
      )
      if (shouldContinue && !shouldContinue()) throw err
      const right = await fetchAliasPageSplitting(
        client,
        pairs.slice(mid),
        page,
        perPage,
        shouldContinue,
      )
      return [...left, ...right]
    }
    if (perPage <= 1) {
      return [{ sets: [], nodeCount: 0, missing: true, pageSize: perPage }]
    }
    return fetchAliasPageSplitting(
      client,
      pairs,
      page,
      Math.max(1, Math.floor(perPage / 2)),
      shouldContinue,
    )
  }
}

async function fetchAliasPage(
  client: StartGgClient,
  pairs: Pair[],
  page: number,
  perPage: number,
): Promise<Array<{ sets: HistorySet[]; nodeCount: number; missing: boolean }>> {
  const variables: Record<string, unknown> = { page }
  pairs.forEach((pair, index) => {
    const ordered = orderedPlayerIds(pair.a, pair.b)
    variables[`p${index}`] = ordered.lowerId
    variables[`o${index}`] = ordered.higherId
  })
  const data = await client.request<
    Record<string, { sets: { nodes: H2HNode[] } | null } | null>
  >(buildAliasQuery(pairs.length, perPage), variables)
  return pairs.map((_, index) => {
    const entry = data[`h${index}`]
    const nodes = entry?.sets?.nodes
    if (entry == null || entry.sets == null || nodes == null) {
      return { sets: [], nodeCount: 0, missing: true }
    }
    const sets = nodes
      .map((node) => mapHistorySet(node))
      .filter((set): set is HistorySet => set != null)
    return { sets, nodeCount: nodes.length, missing: false }
  })
}
