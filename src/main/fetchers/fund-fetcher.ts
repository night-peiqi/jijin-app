import axios, { AxiosError } from 'axios'
import type { FundBasicInfo, FundDetail, Holding } from '@shared/types'

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

/** 判断当前是否是交易时间（9:30-15:00，周一到周五） */
export function isTradingTime(): boolean {
  const now = new Date()
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const hour = now.getHours()
  const minute = now.getMinutes()
  const time = hour * 60 + minute
  return time >= 9 * 60 + 30 && time <= 15 * 60
}

/** 判断当前是否是 20:00 及以后 */
function isAfter20(): boolean {
  return new Date().getHours() >= 20
}

export interface FundValuationResult {
  netValue: number
  netValueDate: string
  estimatedValue: number
  estimatedChange: number
  updateTime: string
  isRealValue: boolean
  isTradingDay?: boolean
}

export interface NetValueHistory {
  date: string
  value: number
}

/**
 * 基金数据服务
 */
export class FundFetcher {
  /**
   * 搜索基金
   */
  async searchFund(code: string): Promise<FundBasicInfo | null> {
    try {
      const url = `${API_BASE}/api/fundsuggest/FundSearch/api/FundSearchAPI.ashx`
      const res = await requestWithRetry(() =>
        axios.get(url, { params: { callback: '', m: 1, key: code }, timeout: TIMEOUT })
      )
      const info = this.parseSearchResult(res.data, code)
      if (!info) return null
      const netInfo = await this.fetchNetValue(code)
      return { ...info, netValue: netInfo.netValue, netValueDate: netInfo.netValueDate }
    } catch (error) {
      console.error(`Failed to search fund ${code}:`, error)
      return null
    }
  }

  /**
   * 获取基金详情
   */
  async getFundDetail(code: string): Promise<FundDetail> {
    const basicInfo = await this.searchFund(code)
    if (!basicInfo) {
      throw new Error(`未找到基金: ${code}`)
    }
    const holdings = await this.fetchHoldings(code)
    return { ...basicInfo, holdings }
  }

  /**
   * 获取基金估值
   */
  async getFundValuation(
    code: string,
    options?: { isRealValue?: boolean; force?: boolean }
  ): Promise<FundValuationResult | null> {
    try {
      const tradingTime = isTradingTime()
      const after20 = isAfter20()
      const force = options?.force ?? false

      console.log(
        `[getFundValuation] code=${code}, force=${force}, tradingTime=${tradingTime}, after20=${after20}`
      )

      // 强制刷新时，总是请求数据
      if (force) {
        if (after20) {
          console.log(`[getFundValuation] ${code}: force + after20, fetching real net value`)
          return await this.fetchRealNetValue(code)
        }
        // 盘中或收盘后20:00前，获取估值
        console.log(`[getFundValuation] ${code}: force, fetching valuation`)
        const url = `${API_BASE}/api/fundgz/js/${code}.js?rt=${Date.now()}`
        const res = await requestWithRetry(() => axios.get(url, { timeout: TIMEOUT }))
        return this.parseValuationResponse(res.data)
      }

      // 非强制刷新的逻辑
      // 20:00 及以后，如果已是真实数据，用缓存
      if (after20 && options?.isRealValue) {
        return null
      }

      // 20:00 及以后，获取真实净值
      if (after20) {
        return await this.fetchRealNetValue(code)
      }

      // 收盘后 20:00 之前，返回 null（使用缓存）
      if (!tradingTime) {
        return null
      }

      // 盘中获取估值
      const url = `${API_BASE}/api/fundgz/js/${code}.js?rt=${Date.now()}`
      const res = await requestWithRetry(() => axios.get(url, { timeout: TIMEOUT }))
      return this.parseValuationResponse(res.data)
    } catch (error) {
      console.error(`Failed to get fund valuation for ${code}:`, error)
      return null
    }
  }

  /**
   * 解析估值响应
   */
  private parseValuationResponse(data: string): FundValuationResult | null {
    const match = data.match(/jsonpgz\((.+)\)/)
    if (match) {
      const json = JSON.parse(match[1])
      const netValue = parseFloat(json.dwjz) || 0
      const estimatedValue = parseFloat(json.gsz) || 0
      const today = new Date().toISOString().split('T')[0]
      const gztime = json.gztime || ''
      const isRealValue = json.jzrq === today || (netValue > 0 && netValue === estimatedValue)
      const isTradingDay = gztime.startsWith(today)

      return {
        netValue,
        netValueDate: json.jzrq || '',
        estimatedValue: isRealValue ? netValue : estimatedValue,
        estimatedChange: parseFloat(json.gszzl) || 0,
        updateTime: gztime || new Date().toISOString(),
        isRealValue,
        isTradingDay
      }
    }
    return null
  }

  /**
   * 获取真实净值（20:00后调用）
   */
  private async fetchRealNetValue(code: string): Promise<FundValuationResult | null> {
    try {
      const url = `${API_BASE}/api/fund/netvalue?code=${code}`
      const res = await requestWithRetry(() => axios.get(url, { timeout: TIMEOUT }))
      const data = res.data
      if (data && data.netValueDate) {
        const today = new Date().toISOString().split('T')[0]
        if (data.netValueDate === today) {
          return {
            netValue: parseFloat(data.netValue) || 0,
            netValueDate: data.netValueDate,
            estimatedValue: parseFloat(data.netValue) || 0,
            estimatedChange: parseFloat(data.change) || 0,
            updateTime: new Date().toISOString(),
            isRealValue: true
          }
        }
      }
      return null
    } catch (error) {
      console.error(`Failed to fetch real net value for ${code}:`, error)
      return null
    }
  }

  /**
   * 获取历史净值
   */
  async fetchNetValueHistory(
    code: string,
    range: '1m' | '3m' | '6m' | '1y' | '3y' | 'all' = '1m'
  ): Promise<NetValueHistory[]> {
    try {
      let targetCount = 30
      switch (range) {
        case '1m':
          targetCount = 25
          break
        case '3m':
          targetCount = 65
          break
        case '6m':
          targetCount = 130
          break
        case '1y':
          targetCount = 250
          break
        case '3y':
          targetCount = 750
          break
        case 'all':
          targetCount = 3000
          break
      }

      const perPage = 49
      const maxPages = Math.ceil(targetCount / perPage)
      const url = `${API_BASE}/api/fundf10/F10DataApi.aspx`

      // 并行请求多页数据
      const pagePromises = []
      for (let page = 1; page <= maxPages; page++) {
        pagePromises.push(
          requestWithRetry(() =>
            axios.get(url, {
              params: { type: 'lsjz', code, per: perPage, page },
              timeout: TIMEOUT
            })
          ).then((res) => this.parseNetValueHistory(res.data))
        )
      }

      const results = await Promise.all(pagePromises)
      let allData: NetValueHistory[] = []
      for (const pageData of results) {
        allData = allData.concat(pageData)
      }

      // 去重并按日期排序
      const dateMap = new Map<string, number>()
      for (const item of allData) {
        if (!dateMap.has(item.date)) {
          dateMap.set(item.date, item.value)
        }
      }

      const uniqueData = Array.from(dateMap.entries())
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => a.date.localeCompare(b.date))

      // 根据时间范围过滤
      const start = new Date()
      switch (range) {
        case '1m':
          start.setMonth(start.getMonth() - 1)
          break
        case '3m':
          start.setMonth(start.getMonth() - 3)
          break
        case '6m':
          start.setMonth(start.getMonth() - 6)
          break
        case '1y':
          start.setFullYear(start.getFullYear() - 1)
          break
        case '3y':
          start.setFullYear(start.getFullYear() - 3)
          break
        case 'all':
          start.setFullYear(2000)
          break
      }
      const startDate = start.toISOString().split('T')[0]
      return uniqueData.filter((d) => d.date >= startDate)
    } catch (error) {
      console.error(`Failed to fetch net value history for ${code}:`, error)
      return []
    }
  }

  /**
   * 获取持仓
   */
  async fetchHoldings(code: string): Promise<Holding[]> {
    try {
      const url = `${API_BASE}/api/fundf10/FundArchivesDatas.aspx`
      const res = await requestWithRetry(() =>
        axios.get(url, {
          params: { type: 'jjcc', code, topline: 10, year: '', month: '', rt: Date.now() },
          timeout: TIMEOUT
        })
      )
      return this.parseHoldings(res.data)
    } catch (error) {
      console.error(`Failed to fetch holdings for ${code}:`, error)
      return []
    }
  }

  private async fetchNetValue(code: string): Promise<{ netValue: number; netValueDate: string }> {
    try {
      const url = `${API_BASE}/api/fundgz/js/${code}.js`
      const res = await requestWithRetry(() => axios.get(url, { timeout: TIMEOUT }))
      const match = res.data.match(/jsonpgz\((.+)\)/)
      if (match) {
        const data = JSON.parse(match[1])
        return { netValue: parseFloat(data.dwjz) || 0, netValueDate: data.jzrq || '' }
      }
    } catch (error) {
      console.error(`Failed to fetch net value for ${code}:`, error)
    }
    return { netValue: 0, netValueDate: '' }
  }

  private parseSearchResult(
    data: unknown,
    targetCode: string
  ): Omit<FundBasicInfo, 'netValue' | 'netValueDate'> | null {
    try {
      let result = data as {
        Datas?: Array<{
          CODE: string
          NAME: string
          CATEGORY: number
          FundBaseInfo?: { FTYPE?: string }
        }>
      }
      if (typeof data === 'string') {
        const jsonStr = data.replace(/^[^{]*/, '').replace(/[^}]*$/, '')
        result = JSON.parse(jsonStr)
      }
      if (!result.Datas?.length) return null
      const fund = result.Datas.find((item) => item.CODE === targetCode && item.CATEGORY === 700)
      if (!fund) return null
      return { code: fund.CODE, name: fund.NAME || '', type: fund.FundBaseInfo?.FTYPE || '混合型' }
    } catch {
      return null
    }
  }

  private parseHoldings(html: string): Holding[] {
    const holdings: Holding[] = []
    try {
      const tableMatch = html.match(/<table class='w782 comm tzxq'>([\s\S]*?)<\/table>/)
      if (!tableMatch) return []
      const rowRegex =
        /<tr><td>\d+<\/td><td><a[^>]*>(\d+)<\/a><\/td><td class='tol'><a[^>]*>([^<]+)<\/a><\/td>[\s\S]*?<td class='tor'>([\d.]+)%<\/td>/g
      let match
      while ((match = rowRegex.exec(tableMatch[1])) !== null && holdings.length < 10) {
        holdings.push({
          stockCode: match[1],
          stockName: match[2].trim(),
          ratio: parseFloat(match[3]) || 0,
          change: 0,
          price: 0
        })
      }
    } catch (error) {
      console.error('Failed to parse holdings:', error)
    }
    return holdings
  }

  private parseNetValueHistory(html: string): NetValueHistory[] {
    const result: NetValueHistory[] = []
    try {
      const rowRegex = /<tr><td>(\d{4}-\d{2}-\d{2})<\/td><td[^>]*>([\d.]+)<\/td>/g
      let match
      while ((match = rowRegex.exec(html)) !== null) {
        result.push({ date: match[1], value: parseFloat(match[2]) || 0 })
      }
      result.reverse()
    } catch (error) {
      console.error('Failed to parse net value history:', error)
    }
    return result
  }
}

export const fundFetcher = new FundFetcher()
