import { PurpleListExportRow } from './types/general'

const axios = require('axios')
const { parse } = require('json2csv')

// Read env at call time so tests (and operators tweaking .env without a
// restart) see the current values. Reading at module load broke a test that
// tried to delete GIVETH_V6_CORE_API_URL after import — the const stayed
// pinned to whatever was set when the file first loaded.
const getV6CoreConfig = () => ({
  url: process.env.GIVETH_V6_CORE_API_URL,
  password: process.env.POWER_SYNC_PASSWORD,
  passwordHeader:
    process.env.POWER_SYNC_PASSWORD_HEADER || 'x-power-sync-password',
  timeoutMs: Number(process.env.GIVETH_V6_CORE_API_TIMEOUT_MS || 15000),
})

const PURPLE_LIST_CSV_FIELDS = ['address', 'network', 'source', 'projectLink']

const dedupeKey = (row: PurpleListExportRow): string =>
  `${(row.address || '').trim().toLowerCase()}:${String(row.network ?? '')
    .trim()
    .toLowerCase()}`

/**
 * Fetches the current GIVbacks purple list from v6 Core (which already merges v5
 * + v6 project recipient addresses and GIVbacks-eligibility-form addresses) and
 * deduplicates it case-insensitively on (address, network). Issue #323.
 */
export const getPurpleListExportRows = async (): Promise<PurpleListExportRow[]> => {
  const cfg = getV6CoreConfig()
  if (!cfg.url || !cfg.password) {
    throw new Error(
      'Cannot export purple list: missing GIVETH_V6_CORE_API_URL or POWER_SYNC_PASSWORD',
    )
  }

  const response = await axios.get(
    `${cfg.url.replace(/\/$/, '')}/api/internal/givbacks/purple-list`,
    {
      headers: {
        [cfg.passwordHeader]: cfg.password,
      },
      timeout: cfg.timeoutMs,
    },
  )

  const rows = response?.data?.data
  if (!Array.isArray(rows)) {
    return []
  }

  const dedupedRows = new Map<string, PurpleListExportRow>()
  for (const row of rows as PurpleListExportRow[]) {
    const key = dedupeKey(row)
    if (!dedupedRows.has(key)) {
      dedupedRows.set(key, row)
    }
  }

  return [...dedupedRows.values()]
}

export const parsePurpleListCsv = (rows: PurpleListExportRow[]): string =>
  parse(rows, { fields: PURPLE_LIST_CSV_FIELDS })

/**
 * Returns a lowercase Set of addresses on v6 Core's purple list. The round
 * export (issue #323) uses this to filter v5 donations whose donor is on v6's
 * purple list but NOT on v5's own (impact-graph) purple list — e.g. a donor
 * added to v6 directly without an impact-graph counterpart.
 *
 * Fails gracefully: returns an empty set on any error (missing config,
 * v6 Core unreachable, endpoint not yet deployed) so the export still
 * works at v5-only-filtering quality until v6 Core is available.
 */
export const getPurpleListAddressSet = async (): Promise<Set<string>> => {
  try {
    const rows = await getPurpleListExportRows()
    const addresses = rows
      .map(row => (row.address || '').trim().toLowerCase())
      .filter(address => address.length > 0)
    return new Set(addresses)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error)
    console.warn(
      `Could not fetch v6 Core purple list; v5 donations will NOT be cross-checked against it. ${message}`,
    )
    return new Set()
  }
}
