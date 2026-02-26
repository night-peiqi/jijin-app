import axios, { AxiosError } from 'axios'
import type { StockQuote } from '@shared/types'

const API_BASE = 'https://fund-eye-server-omrinldkwt.cn-beijing.fcapp.run'
const TIMEOUT = 20000
const MAX_RETRIES = 1

/** 带重试的请求 */
async function requestWithRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (
      retries > 0 &&
      err instanceof AxiosError &&
      (err.code === 'ECONNABORTED' || !err.response)
    ) {
      return requestWithRetry(fn, retries - 1)
    }
    throw err
  }
}

/** 股票行情缓存 */
const stockQuoteCache = new Map<string, { price: number; change: number; time: number }>()
const CACHE_TTL = 60 * 1000 // 缓存1分钟

/**
 * 股票行情服务
 */
export class StockFetcher {
  /**
   * 批量获取股票实时行情
   */
  async getStockQuotes(codes: string[]): Promise<StockQuote[]> {
    if (codes.length === 0) return []

    const result: StockQuote[] = []
    const now = Date.now()
    const needFetch: string[] = []

    // 检查缓存
    for (const code of codes) {
      const cached = stockQuoteCache.get(code)
      if (cached && now - cached.time < CACHE_TTL) {
        result.push({
          code,
          name: '',
          price: cached.price,
          change: cached.change,
          changeAmount: 0
        })
      } else {
        needFetch.push(code)
      }
    }

    // 请求未缓存的
    if (needFetch.length > 0) {
      try {
        const url = `${API_BASE}/api/stock/quotes?codes=${needFetch.join(',')}`
        const res = await requestWithRetry(() => axios.get(url, { timeout: TIMEOUT }))
        if (res.data?.data) {
          for (const item of res.data.data) {
            const quote: StockQuote = {
              code: item.code,
              name: item.name || '',
              price: item.price || 0,
              change: item.change || 0,
              changeAmount: 0
            }
            result.push(quote)
            stockQuoteCache.set(item.code, { price: quote.price, change: quote.change, time: now })
          }
        }
      } catch (error) {
        console.error('Failed to fetch stock quotes:', error)
      }
    }

    return result
  }
}

export const stockFetcher = new StockFetcher()
