/**
 * 以固定并发度执行异步任务，返回与输入顺序一致的 PromiseSettledResult。
 */
export const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> => {
  if (items.length === 0) return []

  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let nextIndex = 0

  const worker = async () => {
    let current = nextIndex++
    while (current < items.length) {
      try {
        const value = await fn(items[current], current)
        results[current] = { status: 'fulfilled', value }
      } catch (reason) {
        results[current] = { status: 'rejected', reason }
      }
      current = nextIndex++
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  )

  return results
}
