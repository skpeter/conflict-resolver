const ENDPOINT = 'https://api.start.gg/gql/alpha'

export type GqlError = {
  message: string
  extensions?: { code?: string }
}

/** start.gg rejects a response that contains more than 1000 objects. Retrying the same query returns the same error. */
export function isQueryComplexityError(err: unknown): boolean {
  const message =
    typeof err === 'string' ? err : err instanceof Error ? err.message : String(err)
  return /complexity is too high|1000 objects/i.test(message)
}

/** HTTP 429 and GraphQL rate-limit errors stop after this many sends. */
export const MAX_RATE_LIMIT_ATTEMPTS = 3

export class StartGgClient {
  private token: string
  private timestamps: number[] = []
  private inFlight = 0
  private queue: Array<() => void> = []
  private epoch = 0

  constructor(token: string) {
    this.token = token
  }

  setToken(token: string) {
    this.token = token
  }

  usesToken(token: string): boolean {
    return this.token === token
  }

  /** A newer load stops retries that belong to the previous one. */
  retire(): void {
    this.epoch += 1
  }

  async request<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const epoch = this.epoch
    await this.acquireSlot()
    try {
      return await this.postWithRetry<T>(query, variables, false, 0, epoch)
    } finally {
      this.releaseSlot()
    }
  }

  private async acquireSlot() {
    for (;;) {
      if (this.inFlight < 4) {
        this.inFlight += 1
        return
      }
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
  }

  private releaseSlot() {
    this.inFlight -= 1
    const next = this.queue.shift()
    if (next) next()
  }

  /** Count this HTTP call against 80 requests per 60 seconds. Sleeps until a slot opens. */
  private async noteSend() {
    for (;;) {
      this.prune()
      if (this.timestamps.length < 80) {
        this.timestamps.push(Date.now())
        return
      }
      const oldest = this.timestamps[0] ?? Date.now()
      const wait = Math.max(25, oldest + 60_000 - Date.now() + 25)
      await sleep(wait)
    }
  }

  private prune() {
    const cutoff = Date.now() - 60_000
    this.timestamps = this.timestamps.filter((t) => t >= cutoff)
  }

  private async postWithRetry<T>(
    query: string,
    variables: Record<string, unknown> | undefined,
    retried: boolean,
    rateAttempts: number,
    epoch: number,
  ): Promise<T> {
    if (epoch !== this.epoch) throw new Error('cancelled')
    await this.noteSend()
    if (epoch !== this.epoch) throw new Error('cancelled')
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query, variables }),
    })

    if (res.status === 429) {
      return this.retryRateLimit(query, variables, retried, rateAttempts, epoch, res)
    }

    let json: {
      data?: T
      errors?: GqlError[]
      success?: boolean
      message?: string
    }
    try {
      json = await res.json()
    } catch {
      if (!retried) return this.postWithRetry(query, variables, true, rateAttempts, epoch)
      throw new Error('start.gg returned a non-JSON response')
    }

    if (json.success === false || (json.message && !json.data)) {
      throw new Error(json.message ?? 'Invalid authentication token')
    }

    if (json.errors?.length) {
      const message = json.errors.map((e) => e.message).join('; ')
      if (/rate limit/i.test(message)) {
        return this.retryRateLimit(query, variables, retried, rateAttempts, epoch, null)
      }
      if (isQueryComplexityError(message)) throw new Error(message)
      if (!retried) return this.postWithRetry(query, variables, true, rateAttempts, epoch)
      throw new Error(message)
    }

    if (!json.data) {
      if (!retried) return this.postWithRetry(query, variables, true, rateAttempts, epoch)
      throw new Error('start.gg returned no data')
    }

    return json.data
  }

  private async retryRateLimit<T>(
    query: string,
    variables: Record<string, unknown> | undefined,
    retried: boolean,
    rateAttempts: number,
    epoch: number,
    res: Response | null,
  ): Promise<T> {
    if (epoch !== this.epoch) throw new Error('cancelled')
    if (rateAttempts + 1 >= MAX_RATE_LIMIT_ATTEMPTS) {
      throw new Error('start.gg rate limit')
    }
    const header = Number(res?.headers.get('retry-after') ?? '2') * 1000
    const wait = res
      ? Number.isFinite(header)
        ? Math.max(1000, header)
        : 2000
      : 2000
    await sleep(wait)
    if (epoch !== this.epoch) throw new Error('cancelled')
    return this.postWithRetry(query, variables, retried, rateAttempts + 1, epoch)
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
