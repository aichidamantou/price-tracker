"""
本地分析引擎 —— 全部阈值集中在这里。

⚠️ 不要把同一个数字散落到多个文件。要调参只改这个文件。
"""

# ── 引擎版本（改算法时递增，写进输出便于追溯）──
ENGINE_VERSION = "1.0"

# ── 趋势 ──────────────────────────────────────────────
TREND_STABLE_THRESHOLD = 2.0     # |change_pct| < 2% 视为 stable
TREND_STRONG_THRESHOLD = 8.0     # |change_pct| >= 8% 且波动小 → strong
TREND_MODERATE_THRESHOLD = 3.0   # >= 3% → moderate，其余 weak

# 近期趋势窗口（天）
RECENT_WINDOWS = (30, 60, 90)
SHORT_AVG_WINDOWS = (7, 30, 60)

# 拐点检测
INFLECTION_MIN_RUN = 2           # 方向至少连续 2 个变化才认
INFLECTION_NOISE_PCT = 1.0       # 单次变化 < 1% 视为噪声，不参与拐点

# ── 倒挂 ──────────────────────────────────────────────
INVERSION_CRITICAL_THRESHOLD = 5.0   # inverted_pct > 5% → critical
INVERSION_TREND_EPS = 0.5            # 倒挂比例变化 < 0.5 个百分点视为 stable

# ── 相对大盘 ──────────────────────────────────────────
RELATIVE_OUTPERFORM = 5.0        # relative > +5% → outperform
RELATIVE_UNDERPERFORM = -5.0     # relative < -5% → underperform

# ── 波动 ──────────────────────────────────────────────
CV_LOW = 0.02                    # 变异系数 < 2% → 低波动
CV_HIGH = 0.08                   # > 8% → 高波动

# ── 异常检测 ──────────────────────────────────────────
ANOMALY_IQR_MULTIPLIER = 2.5     # IQR 倍数
ANOMALY_MIN_SAMPLES = 5          # 少于这个样本数不做异常检测

# ── 风险评分（总分 100）────────────────────────────────
RISK_WEIGHTS = {
    "inversion": 40,   # 倒挂风险
    "trend": 25,       # 趋势风险
    "volatility": 15,  # 波动风险
    "duration": 10,    # 倒挂持续性
    "relative": 10,    # 相对市场表现
}
RISK_HIGH_THRESHOLD = 70         # >= 70 → high
RISK_MEDIUM_THRESHOLD = 40       # >= 40 → medium，其余 low

# ── 预测 ──────────────────────────────────────────────
PREDICTION_HORIZON_DAYS = 30
PREDICTION_MIN_POINTS = 4        # 有效价格点少于这个数不预测
PREDICTION_MIN_SPAN_DAYS = 14    # 历史跨度短于这个天数不预测
PREDICTION_MAX_GAP_DAYS = 60     # 相邻点间隔超过这个天数视为数据不连续
PREDICTION_RECENT_POINTS = 12    # 只用最近 N 个点做回归
PREDICTION_INTERVAL_Z = 1.28     # 80% 区间

# ── 数据质量 ──────────────────────────────────────────
MIN_HISTORY_POINTS = 3           # 少于这个有效点数视为"历史不足"

# ── 品类 ──────────────────────────────────────────────
CATEGORY_SLIM = "细支"
CATEGORY_MEDIUM = "中支"
CATEGORY_REGULAR = "常规"
CATEGORY_ORDER = (CATEGORY_SLIM, CATEGORY_MEDIUM, CATEGORY_REGULAR)

# 结构性风险候选：满足的条数阈值
STRUCTURAL_RISK_MIN_HITS = 3
STRUCTURAL_RISK_CONDITIONS = (
    "long_term_down",       # 长期下跌
    "persistent_inverted",  # 持续倒挂
    "underperform_market",  # 跌幅明显高于市场
    "weak_recovery",        # 恢复能力弱
)

# 恢复能力
RECOVERY_WEAK_THRESHOLD = 0.30   # 恢复比例 < 30% 视为恢复能力弱
