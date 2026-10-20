"""Bundle the existing Vite output as one network-free HTML with synthetic seed only."""

from pathlib import Path
import re
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
dist = root / "frontend/dist"
html = (dist / "index.html").read_text()


def inline_script(match):
    path = dist / match[1].lstrip("/")
    return (
        '<script type="module">'
        + path.read_text().replace("</script", "<\\/script")
        + "</script>"
    )


html = re.sub(
    r'<script\s+type="module"[^>]*src="([^"]+)"[^>]*></script>', inline_script, html
)
html = re.sub(
    r'<link\s+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>',
    lambda m: "<style>" + (dist / m[1].lstrip("/")).read_text() + "</style>",
    html,
)
html = html.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-mode="offline">')
html = html.replace(
    "<head>",
    "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'\">",
)
if (
    'src="/assets/' in html
    or 'href="/assets/' in html
    or 'data-mode="offline"' not in html
):
    raise RuntimeError("HTML bundle is not self contained")
release = root / "releases"
release.mkdir(exist_ok=True)
name = "StockPilot-演示体验.html"
(release / name).write_text(html, encoding="utf-8")
guide = """AI StockPilot 中文体验指南

1. 下载并解压这个压缩包，双击 StockPilot-演示体验.html，用 Chrome、Edge、Firefox 或 Safari 打开。
2. 不需要安装Python或Node，不需要联网、API密钥或证券账户。若手机文件预览不运行网页脚本，请在电脑浏览器打开。
3. 点击右上角太阳/月亮切换深浅色；点击使用指南查看流程。首页已有美股、A股、盈亏持仓和历史交易。
4. 点击图表近5日/近20日/全部样例，可用鼠标、触控或滑杆逐日查看。
5. 点我的持仓右侧箭头看诊断；股票研究可收藏；风控中心可保存规则；分析报告可生成并下载。
6. 模拟交易：美元模拟账户 + AAPL + 10股，创建订单；明确勾选历史演示时钟，再点模拟成交。选择模拟卖出10股再成交，即可体验平仓。A股同一演示日买入不能卖出。
7. 导入与设置：先下载CSV模板，填写已发生成交（账户1美元/2人民币，时间带时区），选择文件，校验预览，确认导入。仅支持内置6只标的。离线CSV不支持引号或多行单元格。
8. 所有行情、汇率和初始资金都是虚构样例，AI使用规则解释，绝非真实或实时行情。今日无行情会如实显示，不把过期报价当今日盈亏。
9. 本页只在本机浏览器计算与保存，不连接FastAPI，不连接任何券商，不发送网络请求。文件本身只包含演示种子，不包含当前工作区用户账本。真实交易功能不存在。
10. 导入/修改保存在此浏览器本机，与SQLite完整版不自动同步。请通过导出CSV/报告保存副本；更换浏览器或清理浏览器数据可能丢失修改。请勿把含自己交易的CSV或报告公开分享。

完整FastAPI+React版本仍在原项目中，开发启动与全部限制详见README。此文件是云平台暂未提供端口预览时的独立可交互替代方案，不是云端公网网站。
"""
(release / "打开即用-使用说明.txt").write_text(guide, encoding="utf-8")
with ZipFile(release / "StockPilot-离线体验.zip", "w", ZIP_DEFLATED) as archive:
    archive.write(release / name, name)
    archive.writestr("打开即用-使用说明.txt", guide)
    archive.writestr(
        "持仓导入模板.csv",
        "account_id,symbol,side,quantity,price,fee,traded_at\n1,AAPL,buy,10,220,1,2026-10-15T10:00:00-04:00\n",
    )
print(f"Created {name} and offline ZIP; no private database packaged.")
