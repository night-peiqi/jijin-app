/**
 * 主进程类型定义
 */

export type { FundValuationResult, NetValueHistory } from './fetchers'

import type { Fund } from '@shared/types'

/**
 * 存储服务接口
 */
export interface IStorageService {
  getWatchlist(): Fund[]
  saveWatchlist(funds: Fund[]): void
}
