<template>
  <div class="fund-list">
    <!-- 今日预估卡片 -->
    <div class="total-card" :class="getProfitClass(totalProfit)">
      <span class="total-label">今日预估</span>
      <span class="total-value">{{ formatProfit(totalProfit) }} 元</span>
    </div>

    <!-- 列表头部 -->
    <div class="list-header">
      <span class="header-title">自选基金 ({{ funds.length }})</span>
      <div class="header-actions">
        <el-button-group size="small">
          <el-button
            :type="sortOrder === 'desc' ? 'primary' : 'default'"
            @click="handleSort('desc')"
          >
            涨幅↓
          </el-button>
          <el-button :type="sortOrder === 'asc' ? 'primary' : 'default'" @click="handleSort('asc')">
            涨幅↑
          </el-button>
        </el-button-group>
        <el-button size="small" @click="handleRefresh">
          <el-icon :class="{ 'is-loading': props.refreshing }"><Refresh /></el-icon>
        </el-button>
        <el-button v-if="funds.length > 0" size="small" type="danger" plain @click="handleClearAll">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
    </div>

    <!-- 列表表头 -->
    <div class="list-table-header">
      <span class="col-fund">基金</span>
      <span class="col-profit">收益</span>
      <span class="col-value">估值/份额</span>
    </div>

    <!-- 空状态 -->
    <div v-if="funds.length === 0" class="empty-state">
      <el-empty description="暂无自选基金，请搜索添加" />
    </div>

    <!-- 基金列表 -->
    <div v-else class="list-content">
      <div
        v-for="fund in sortedFunds"
        :key="fund.code"
        class="fund-item"
        :class="{ 'is-selected': selectedCode === fund.code }"
        @click="handleSelect(fund)"
      >
        <!-- 基金信息列 -->
        <div class="col-fund">
          <span class="fund-name">{{ fund.name }}</span>
          <span class="fund-code">{{ fund.code }}</span>
        </div>

        <!-- 收益列 -->
        <div class="col-profit">
          <span class="change-percent" :class="getChangeClass(fund.estimatedChange)">
            {{ formatChange(fund.estimatedChange) }}
          </span>
          <span class="profit-amount" :class="getChangeClass(fund.estimatedChange)">
            {{ formatFundProfit(fund) }}
          </span>
        </div>

        <!-- 估值/份额列 -->
        <div class="col-value">
          <span class="estimated-value">{{ formatValue(fund.estimatedValue) }}</span>
          <span class="shares-value" @click.stop="handleEditShares(fund)">
            {{ formatShares(fund.shares) }}
          </span>
        </div>
      </div>
    </div>

    <!-- 份额编辑弹窗 -->
    <el-dialog
      v-model="sharesDialogVisible"
      title="设置持有份额"
      width="320px"
      :close-on-click-modal="false"
    >
      <div class="shares-dialog-content">
        <p class="shares-fund-name">{{ editingFund?.name }}</p>
        <el-input-number
          v-model="editingShares"
          :min="0"
          :precision="2"
          :step="100"
          placeholder="请输入持有份额"
          style="width: 100%"
        />
      </div>
      <template #footer>
        <el-button @click="sharesDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveShares">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { Refresh, Delete } from '@element-plus/icons-vue'
import type { Fund } from '@shared/types'

const props = defineProps<{
  funds: Fund[]
  selectedCode?: string
  totalProfit?: number | null
  refreshing?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', fund: Fund): void
  (e: 'sort', order: 'asc' | 'desc'): void
  (e: 'clear-all'): void
  (e: 'refresh'): void
  (e: 'update-shares', code: string, shares: number): void
}>()

const sortOrder = ref<'asc' | 'desc'>('desc')
const sharesDialogVisible = ref(false)
const editingFund = ref<Fund | null>(null)
const editingShares = ref(0)

/**
 * 排序后的基金列表
 */
const sortedFunds = computed(() => {
  const sorted = [...props.funds]
  if (sortOrder.value === 'desc') {
    sorted.sort((a, b) => b.estimatedChange - a.estimatedChange)
  } else {
    sorted.sort((a, b) => a.estimatedChange - b.estimatedChange)
  }
  return sorted
})

function handleSelect(fund: Fund) {
  emit('select', fund)
}

function handleSort(order: 'asc' | 'desc') {
  sortOrder.value = order
  emit('sort', order)
}

function handleRefresh() {
  emit('refresh')
}

async function handleClearAll() {
  try {
    await ElMessageBox.confirm(`确定要清空全部 ${props.funds.length} 个自选基金吗？`, '清空确认', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning'
    })
    emit('clear-all')
    ElMessage.success('已清空')
  } catch {
    // 用户取消
  }
}

/**
 * 打开份额编辑弹窗
 */
function handleEditShares(fund: Fund) {
  editingFund.value = fund
  editingShares.value = fund.shares || 0
  sharesDialogVisible.value = true
}

/**
 * 保存份额
 */
function handleSaveShares() {
  if (editingFund.value) {
    emit('update-shares', editingFund.value.code, editingShares.value)
    ElMessage.success('份额已更新')
  }
  sharesDialogVisible.value = false
}

/**
 * 格式化净值显示
 */
function formatValue(value: number): string {
  if (!value || isNaN(value)) return '--'
  return value.toFixed(4)
}

/**
 * 格式化涨跌幅显示
 */
function formatChange(change: number | null | undefined): string {
  if (change === null || change === undefined || isNaN(change)) return '--'
  const sign = change >= 0 ? '+' : ''
  return `${sign}${change.toFixed(2)}%`
}

/**
 * 格式化份额显示
 */
function formatShares(shares: number | undefined): string {
  if (!shares || shares === 0) return '设置份额'
  return shares.toFixed(2)
}

/**
 * 计算单个基金的预估盈利
 * 盈利 = 份额 × 估值 × 涨跌幅% / (1 + 涨跌幅%)
 * 即：今日市值 - 昨日市值 = 份额 × 估值 - 份额 × 昨日净值
 */
function formatFundProfit(fund: Fund): string {
  if (!fund.shares || fund.shares === 0) return '--'
  if (fund.estimatedChange === undefined || isNaN(fund.estimatedChange)) return '--'
  if (!fund.estimatedValue || fund.estimatedValue === 0) return '--'

  // 今日市值
  const todayValue = fund.shares * fund.estimatedValue
  // 昨日净值 = 今日估值 / (1 + 涨跌幅%)
  const yesterdayNetValue = fund.estimatedValue / (1 + fund.estimatedChange / 100)
  // 昨日市值
  const yesterdayValue = fund.shares * yesterdayNetValue
  // 盈利
  const profit = todayValue - yesterdayValue

  const sign = profit >= 0 ? '+' : ''
  return `${sign}${profit.toFixed(2)}`
}

/**
 * 格式化总盈利显示
 */
function formatProfit(profit: number | null | undefined): string {
  if (profit === null || profit === undefined || isNaN(profit)) return '+0.00'
  const sign = profit >= 0 ? '+' : ''
  return `${sign}${profit.toFixed(2)}`
}

/**
 * 获取涨跌颜色类名
 */
function getChangeClass(change: number | undefined): string {
  if (change === undefined || isNaN(change)) return 'change-neutral'
  if (change > 0) return 'change-up'
  if (change < 0) return 'change-down'
  return 'change-neutral'
}

/**
 * 获取盈利颜色类名
 */
function getProfitClass(profit: number | null | undefined): string {
  if (profit === null || profit === undefined || isNaN(profit)) return 'change-neutral'
  if (profit > 0) return 'change-up'
  if (profit < 0) return 'change-down'
  return 'change-neutral'
}
</script>

<style scoped>
.fund-list {
  background: #ffffff;
  border-radius: 8px;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: #303133;
}

/* 今日预估卡片 */
.total-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: #ffffff;
  border-bottom: 1px solid #ebeef5;
}

.total-label {
  font-size: 14px;
  color: #909399;
}

.total-value {
  font-size: 24px;
  font-weight: 700;
  font-family: 'SF Mono', Monaco, monospace;
}

.total-card.change-up .total-value {
  color: #f56c6c;
}

.total-card.change-down .total-value {
  color: #67c23a;
}

.total-card.change-neutral .total-value {
  color: #909399;
}

/* 列表头部 */
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* 列表表头 */
.list-table-header {
  display: grid;
  grid-template-columns: 1fr 100px 100px;
  padding: 10px 16px;
  font-size: 13px;
  color: #909399;
  background: #f5f7fa;
  border-bottom: 1px solid #ebeef5;
}

.list-table-header .col-profit,
.list-table-header .col-value {
  text-align: right;
}

/* 空状态 */
.empty-state {
  padding: 40px 20px;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 列表内容 */
.list-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

/* 基金项 */
.fund-item {
  display: grid;
  grid-template-columns: 1fr 100px 100px;
  padding: 14px 16px;
  border-bottom: 1px solid #ebeef5;
  cursor: pointer;
  transition: background-color 0.2s;
}

.fund-item:hover {
  background-color: #f5f7fa;
}

.fund-item.is-selected {
  background-color: #ecf5ff;
}

.fund-item:last-child {
  border-bottom: none;
}

/* 基金信息列 */
.fund-item .col-fund {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.fund-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fund-code {
  font-size: 12px;
  color: #909399;
}

/* 收益列 */
.fund-item .col-profit {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.change-percent {
  font-size: 14px;
  font-weight: 600;
  font-family: 'SF Mono', Monaco, monospace;
}

.profit-amount {
  font-size: 12px;
  font-family: 'SF Mono', Monaco, monospace;
}

/* 估值/份额列 */
.fund-item .col-value {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.estimated-value {
  font-size: 14px;
  font-family: 'SF Mono', Monaco, monospace;
  color: #303133;
}

.shares-value {
  font-size: 12px;
  color: #409eff;
  cursor: pointer;
  transition: color 0.2s;
}

.shares-value:hover {
  color: #66b1ff;
  text-decoration: underline;
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

/* 份额编辑弹窗 */
.shares-dialog-content {
  text-align: center;
}

.shares-fund-name {
  margin-bottom: 16px;
  font-size: 14px;
  color: #606266;
}

/* 响应式适配 */
@media (max-width: 600px) {
  .list-header {
    padding: 10px 12px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .header-title {
    font-size: 14px;
  }

  .list-table-header,
  .fund-item {
    grid-template-columns: 1fr 80px 80px;
    padding: 10px 12px;
  }

  .fund-name {
    font-size: 13px;
    max-width: 100px;
  }

  .change-percent {
    font-size: 13px;
  }

  .total-value {
    font-size: 20px;
  }
}
</style>
