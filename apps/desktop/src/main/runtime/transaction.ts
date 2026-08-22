import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { writeAtomicJson } from '@ldd/runtime-kit/atomic-json'

export type RuntimeTransactionState =
  | 'idle'
  | 'extracting'
  | 'verifying'
  | 'health-checking'
  | 'installed'
  | 'activating'
  | 'observing'
  | 'committed'
  | 'rolled-back'
  | 'failed'

interface TransactionMarker {
  readonly schemaVersion: 1
  readonly id: string
  readonly state: RuntimeTransactionState
}

const markerName = '.ldd-runtime-transaction.json'
const allowedTransitions: Readonly<Record<RuntimeTransactionState, ReadonlySet<RuntimeTransactionState>>> = {
  idle: new Set(['extracting', 'activating', 'failed']),
  extracting: new Set(['verifying', 'failed']),
  verifying: new Set(['health-checking', 'failed']),
  'health-checking': new Set(['installed', 'failed']),
  installed: new Set(),
  activating: new Set(['observing', 'rolled-back', 'failed']),
  observing: new Set(['committed', 'rolled-back', 'failed']),
  committed: new Set(),
  'rolled-back': new Set(),
  failed: new Set(),
}

export class RuntimeTransaction {
  readonly id: string
  readonly stagingRoot: string
  readonly path: string
  #state: RuntimeTransactionState

  private constructor(id: string, stagingRoot: string, transactionPath: string) {
    this.id = id
    this.stagingRoot = stagingRoot
    this.path = transactionPath
    this.#state = 'idle'
  }

  static async create(stagingRoot: string): Promise<RuntimeTransaction> {
    await mkdir(stagingRoot, { mode: 0o700, recursive: true })
    const canonicalRoot = await realpath(stagingRoot)
    const id = randomUUID()
    const transactionPath = join(canonicalRoot, `tx-${id}`)
    await mkdir(transactionPath, { mode: 0o700, recursive: false })
    const transaction = new RuntimeTransaction(id, canonicalRoot, transactionPath)
    await transaction.#writeMarker()
    return transaction
  }

  get state(): RuntimeTransactionState {
    return this.#state
  }

  childPath(...segments: readonly string[]): string {
    const child = resolve(this.path, ...segments)
    if (!child.startsWith(`${this.path}${sep}`)) {
      throw new Error('transaction child path escapes its owned staging directory')
    }
    return child
  }

  async transition(next: RuntimeTransactionState): Promise<void> {
    if (!allowedTransitions[this.#state].has(next)) {
      throw new Error(`invalid runtime transaction transition: ${this.#state} -> ${next}`)
    }
    const previous = this.#state
    this.#state = next
    try {
      await this.#writeMarker()
    } catch (error) {
      this.#state = previous
      throw error
    }
  }

  async cleanup(): Promise<void> {
    const relativePath = relative(this.stagingRoot, this.path)
    if (
      relativePath.length === 0 ||
      relativePath.startsWith(`..${sep}`) ||
      relativePath === '..' ||
      basename(this.path) !== `tx-${this.id}`
    ) {
      throw new Error('refusing to clean a non-transaction staging path')
    }
    const directoryMetadata = await lstat(this.path)
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new Error('refusing to clean a link-shaped transaction path')
    }
    const markerPath = join(this.path, markerName)
    const markerMetadata = await lstat(markerPath)
    if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink()) {
      throw new Error('refusing to clean a transaction without a regular marker')
    }
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Partial<TransactionMarker>
    if (marker.schemaVersion !== 1 || marker.id !== this.id || marker.state !== this.#state) {
      throw new Error('refusing to clean a transaction with a mismatched marker')
    }
    await rm(this.path, { force: false, recursive: true })
  }

  async #writeMarker(): Promise<void> {
    await writeAtomicJson(join(this.path, markerName), {
      schemaVersion: 1,
      id: this.id,
      state: this.#state,
    } satisfies TransactionMarker)
  }
}
