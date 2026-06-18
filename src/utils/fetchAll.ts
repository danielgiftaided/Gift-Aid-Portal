import { supabase } from '../lib/supabase'

/**
 * Supabase/PostgREST caps a single response at 1000 rows by default,
 * regardless of how many rows actually match the query. This silently
 * truncates results with no error — which is exactly the bug that caused
 * "only 1000 records show" on the pending charities page.
 *
 * This helper pages through in batches of 1000 until every matching row
 * has been fetched, so counts and charts are always accurate no matter
 * how large the dataset grows.
 *
 * Usage:
 *   const rows = await fetchAllRows<MyRowType>(() =>
 *     supabase.from('table_name').select('col1, col2').eq('x', y)
 *   )
 */
export async function fetchAllRows<T>(buildQuery: () => any): Promise<T[]> {
  const PAGE_SIZE = 1000
  let all: T[] = []
  let from = 0

  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    all = all.concat(data as T[])
    if (data.length < PAGE_SIZE) break // last page reached
    from += PAGE_SIZE
  }

  return all
}
