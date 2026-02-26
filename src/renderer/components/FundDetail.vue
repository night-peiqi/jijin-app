<template>
  <div class="fund-detail">
    <div v-if="!fund" class="no-selection">
      <el-empty description="点击左侧基金可查看详情" />
    </div>

    <template v-else>
      <!-- 基金基本信息 -->
      <div class="detail-header">
        <div class="header-info">
          <h2 class="fund-name">{{ fund.name }}</h2>
          <span class="fund-code">{{ fund.code }}</span>
        </div>
        <el-button type="danger" size="small" :loading="deleting" @click="handleDelete">
          删除
        </el-button>
      </div>

      <!-- 估值信息 -->
      <div class="valuation-section">
        <div class="valuation-main">
          <span class="valuation-label">估值净值</span>
          <span class="valuation-value">{{ formatValue(fund.estimatedValue) }}</span>
          <span class="valuation-change" :class="getChangeClass(fund.estimatedChange)">
            {{ formatChange(fund.estimatedChange) }}
          </span>
        </div>
        <div class="valuation-meta">
          <span>昨日净值: {{ formatValue(fund.netValue) }}</span>
          <span>净值日期: {{ fund.netValueDate }}</span>
          <span>更新时间: {{ formatTime(fund.updateTime) }}</span>
        </div>
      </div>

      <!-- 历史净值曲线 -->
      <div class="history-section">
        <div class="history-header">
          <h3 class="section-title">历史净值</h3>
          <el-button-group size="small">
            <el-button
              v-for="r in rangeOptions"
              :key="r.value"
              :type="selectedRange === r.value ? 'primary' : 'default'"
              @click="changeRange(r.value)"
            >
              {{ r.label }}
            </el-button>
          </el-button-group>
        </div>

        <!-- 统计信息 -->
        <div v-if="historyData.length > 0" class="history-stats">
          <div class="stat-item">
            <span class="stat-label">区间涨幅</span>
            <span class="stat-value" :class="getChangeClass(rangeChange)">
              {{ formatChange(rangeChange) }}
            </span>
          </div>
          <div class="stat-item">
            <span class="stat-label">最高</span>
            <span class="stat-value">{{ maxValue.toFixed(4) }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">最低</span>
            <span class="stat-value">{{ minValue.toFixed(4) }}</span>
          </div>
        </div>

        <!-- 曲线图 -->
        <div ref="chartRef" class="chart-container">
          <div v-if="loadingHistory" class="chart-loading">
            <el-icon class="is-loading"><Loading /></el-icon>
            加载中...
          </div>
          <canvas v-show="!loadingHistory && historyData.length > 0" ref="canvasRef"></canvas>
          <div v-if="!loadingHistory && historyData.length === 0" class="chart-empty">
            暂无历史数据
          </div>
        </div>
      </div>

      <!-- 前十大持仓 -->
      <div class="holdings-section">
        <h3 class="section-title">前十大持仓</h3>

        <div v-if="fund.holdings.length === 0" class="no-holdings">
          <el-empty description="暂无持仓数据" :image-size="60" />
        </div>

        <el-table v-else :data="fund.holdings" stripe size="small" class="holdings-table">
          <el-table-column prop="stockName" label="股票名称" min-width="100">
            <template #default="{ row }">
              <span class="stock-name">{{ row.stockName }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="stockCode" label="代码" width="80">
            <template #default="{ row }">
              <span class="stock-code">{{ row.stockCode }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="ratio" label="占比" width="70" align="right">
            <template #default="{ row }"> {{ row.ratio.toFixed(2) }}% </template>
          </el-table-column>
          <el-table-column prop="change" label="涨跌幅" width="80" align="right">
            <template #default="{ row }">
              <span :class="getChangeClass(row.change)">
                {{ formatChange(row.change) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="price" label="现价" width="80" align="right">
            <template #default="{ row }">
              {{ row.price ? row.price.toFixed(2) : '--' }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import type { Fund } from '@shared/types'

interface NetValueHistory {
  date: string
  value: number
}

const props = defineProps<{
  fund: Fund | null
}>()

const emit = defineEmits<{
  (e: 'delete', code: string): void
}>()

const deleting = ref(false)
const loadingHistory = ref(false)
const historyData = ref<NetValueHistory[]>([])
const selectedRange = ref<'1m' | '3m' | '6m' | '1y' | '3y' | 'all'>('1m')
const chartRef = ref<HTMLDivElement>()
const canvasRef = ref<HTMLCanvasElement>()

// 历史数据缓存：{ fundCode: { range: { data, date } } }
const historyCache = new Map<string, Map<string, { data: NetValueHistory[]; date: string }>>()

const rangeOptions = [
  { label: '近1月', value: '1m' as const },
  { label: '近3月', value: '3m' as const },
  { label: '近6月', value: '6m' as const },
  { label: '近1年', value: '1y' as const },
  { label: '近3年', value: '3y' as const },
  { label: '成立来', value: 'all' as const }
]

// 计算统计数据
const rangeChange = computed(() => {
  if (historyData.value.length < 2) return 0
  const first = historyData.value[0].value
  const last = historyData.value[historyData.value.length - 1].value
  return ((last - first) / first) * 100
})

const maxValue = computed(() => {
  if (historyData.value.length === 0) return 0
  return Math.max(...historyData.value.map((d) => d.value))
})

const minValue = computed(() => {
  if (historyData.value.length === 0) return 0
  return Math.min(...historyData.value.map((d) => d.value))
})

// 监听基金变化，加载历史数据
watch(
  () => props.fund?.code,
  async (newCode) => {
    if (newCode) {
      selectedRange.value = '1m'
      await loadHistory(newCode, '1m')
    } else {
      historyData.value = []
    }
  },
  { immediate: true }
)

// 切换时间范围
async function changeRange(range: '1m' | '3m' | '6m' | '1y' | '3y' | 'all') {
  if (!props.fund) return
  selectedRange.value = range
  await loadHistory(props.fund.code, range)
}

// 加载历史数据（带缓存）
async function loadHistory(code: string, range: string) {
  const today = new Date().toISOString().split('T')[0]

  // 检查缓存
  const fundCache = historyCache.get(code)
  if (fundCache) {
    const rangeCache = fundCache.get(range)
    if (rangeCache && rangeCache.date === today) {
      historyData.value = rangeCache.data
      await nextTick()
      drawChart()
      return
    }
  }

  // 请求数据
  loadingHistory.value = true
  try {
    const result = await window.electronAPI.getNetValueHistory(code, range)
    if (result.success && result.data) {
      historyData.value = result.data

      // 更新缓存
      if (!historyCache.has(code)) {
        historyCache.set(code, new Map())
      }
      historyCache.get(code)!.set(range, { data: result.data, date: today })

      await nextTick()
      drawChart()
    }
  } catch (error) {
    console.error('Failed to load history:', error)
  } finally {
    loadingHistory.value = false
  }
}

// 绘制曲线图
function drawChart() {
  if (!canvasRef.value || !chartRef.value || historyData.value.length === 0) return

  const canvas = canvasRef.value
  const container = chartRef.value
  const dpr = window.devicePixelRatio || 1

  // 设置画布尺寸
  const width = container.clientWidth
  const height = 200
  canvas.width = width * dpr
  canvas.height = height * dpr
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.scale(dpr, dpr)

  // 清空画布
  ctx.clearRect(0, 0, width, height)

  const data = historyData.value
  const padding = { top: 20, right: 60, bottom: 30, left: 40 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  // 计算数据范围
  const values = data.map((d) => d.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const yPadding = range * 0.1

  // 绘制Y轴刻度
  ctx.fillStyle = '#909399'
  ctx.font = '11px SF Mono, Monaco, monospace'
  ctx.textAlign = 'right'

  const ySteps = 4
  for (let i = 0; i <= ySteps; i++) {
    const value = min - yPadding + ((max - min + yPadding * 2) * i) / ySteps
    const y = padding.top + chartHeight - (chartHeight * i) / ySteps
    ctx.fillText(value.toFixed(4), width - 5, y + 4)
  }

  // 绘制X轴日期
  ctx.textAlign = 'center'
  const xSteps = Math.min(5, data.length - 1)
  for (let i = 0; i <= xSteps; i++) {
    const index = Math.floor((i * (data.length - 1)) / xSteps)
    const x = padding.left + (chartWidth * index) / (data.length - 1)
    const date = data[index].date.slice(2).replace(/-/g, '/')
    ctx.fillText(date, x, height - 8)
  }

  // 绘制曲线
  ctx.beginPath()
  ctx.strokeStyle = '#f56c6c'
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'

  data.forEach((d, i) => {
    const x = padding.left + (chartWidth * i) / (data.length - 1)
    const y =
      padding.top +
      chartHeight -
      ((d.value - min + yPadding) / (range + yPadding * 2)) * chartHeight

    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  })

  ctx.stroke()
}

// 删除基金
async function handleDelete() {
  if (!props.fund) return

  try {
    await ElMessageBox.confirm(`确定要删除「${props.fund.name}」吗？`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })

    deleting.value = true
    try {
      await window.electronAPI.removeFund(props.fund.code)
      emit('delete', props.fund.code)
      ElMessage.success('删除成功')
    } catch (err) {
      ElMessage.error('删除失败')
      console.error('Delete fund error:', err)
    } finally {
      deleting.value = false
    }
  } catch {
    // 用户取消
  }
}

function formatValue(value: number): string {
  if (!value || isNaN(value)) return '--'
  return value.toFixed(4)
}

function formatChange(change: number): string {
  if (change === undefined || isNaN(change)) return '--'
  const sign = change >= 0 ? '+' : ''
  return `${sign}${change.toFixed(2)}%`
}

function getChangeClass(change: number): string {
  if (change === undefined || isNaN(change)) return 'change-neutral'
  if (change > 0) return 'change-up'
  if (change < 0) return 'change-down'
  return 'change-neutral'
}

function formatTime(time: string): string {
  if (!time) return '--'
  try {
    const date = new Date(time)
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return '--'
  }
}
</script>

<style scoped>
.fund-detail {
  background: white;
  border-radius: 8px;
  padding: 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.no-selection {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 200px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #ebeef5;
}

.header-info {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
  flex: 1;
}

.fund-name {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin: 0;
  word-break: break-word;
}

.fund-code {
  font-size: 14px;
  color: #909399;
}

.valuation-section {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
}

.valuation-main {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.valuation-label {
  font-size: 14px;
  color: #606266;
}

.valuation-value {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
  font-family: 'SF Mono', Monaco, monospace;
}

.valuation-change {
  font-size: 18px;
  font-weight: 600;
  font-family: 'SF Mono', Monaco, monospace;
}

.valuation-meta {
  display: flex;
  gap: 20px;
  font-size: 13px;
  color: #909399;
  flex-wrap: wrap;
}

/* 历史净值区域 */
.history-section {
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid #ebeef5;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.history-stats {
  display: flex;
  gap: 40px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 12px;
  color: #909399;
}

.stat-value {
  font-size: 16px;
  font-weight: 600;
  font-family: 'SF Mono', Monaco, monospace;
  color: #303133;
}

.chart-container {
  position: relative;
  width: 100%;
  height: 200px;
  background: #fafafa;
  border-radius: 8px;
}

.chart-loading,
.chart-empty {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  font-size: 14px;
  gap: 8px;
}

/* 持仓区域 */
.holdings-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 16px 0;
}

.no-holdings {
  padding: 20px;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.holdings-table {
  width: 100%;
}

.stock-name {
  font-weight: 500;
}

.stock-code {
  color: #909399;
  font-size: 12px;
}

/* 涨跌颜色 */
.change-up {
  color: #f56c6c;
}

.change-down {
  color: #67c23a;
}

.change-neutral {
  color: #909399;
}

/* 响应式 */
@media (max-width: 600px) {
  .fund-detail {
    padding: 12px;
  }

  .history-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .history-stats {
    gap: 20px;
  }

  .valuation-value {
    font-size: 24px;
  }
}
</style>
