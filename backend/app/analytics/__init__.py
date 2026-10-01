"""本地价格分析引擎。

    from .analytics import analysis_engine
    local = analysis_engine.run(products, date_from, date_to)

产出完整的结构化分析结果，AI 只负责解释它，不再接触原始价格记录。
"""

from . import analysis_engine  # noqa: F401
from . import config  # noqa: F401
