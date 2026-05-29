import { PurpleListExportRow } from './types/general'

const axios = require('axios')
const { parse } = require('json2csv')

const givethV6CoreApiUrl = process.env.GIVETH_V6_CORE_API_URL
const givethV6CoreApiPassword = process.env.POWER_SYNC_PASSWORD
const givethV6CoreApiPasswordHeader =
  process.env.POWER_SYNC_PASSWORD_HEADER || 'x-power-sync-password'
const givethV6CoreApiTimeoutMs = Number(
  process.env.GIVETH_V6_CORE_API_TIMEOUT_MS || 15000,
)

const PURPLE_LIST_CSV_FIELDS = ['address', 'network', 'source', 'projectLink']

const dedupeKey = (row: PurpleListExportRow): string =>
  `${(row.address || '').trim().toLowerCase()}:${row.network ?? ''}`

/**
 * Fetches the current GIVbacks purple list from v6 Core (which already merges v5
 * + v6 project recipient addresses and GIVbacks-eligibility-form addresses) and
 * deduplicates it case-insensitively on (address, network). Issue #323.
 */
export const getPurpleListExportRows = async (): Promise<PurpleListExportRow[]> => {
  if (!givethV6CoreApiUrl || !givethV6CoreApiPassword) {
    throw new Error(
      'Cannot export purple list: missing GIVETH_V6_CORE_API_URL or POWER_SYNC_PASSWORD',
    )
  }

  const response = await axios.get(
    `${givethV6CoreApiUrl.replace(/\/$/, '')}/api/internal/givbacks/purple-list`,
    {
      headers: {
        [givethV6CoreApiPasswordHeader]: givethV6CoreApiPassword,
      },
      timeout: givethV6CoreApiTimeoutMs,
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
