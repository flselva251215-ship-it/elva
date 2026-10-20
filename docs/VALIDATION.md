# 第一版验收记录

验证日期：2026-10-20（Asia/Shanghai）。环境：Python 3.12.14、Node.js 24.19.0、Linux、本机 Chromium。结果对应本次实际执行，不代表远端 CI 已运行或云环境已发布。

| 验证 | 实际结果 |
|---|---|
| `bash scripts/setup.sh` | 通过，使用 Python 和 npm 锁文件安装并构建；重复运行成功 |
| Ruff | 通过 |
| `cd backend && ../.venv/bin/pytest -q` | **45 passed**；1 项 Starlette/AnyIO 第三方弃用警告，无跳过 |
| `npm --prefix frontend run typecheck` | 通过 |
| `npm --prefix frontend run lint` | 通过 |
| `npm --prefix frontend run build` | 通过，Vite 6.4.4 |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`（frontend） | **6 passed**，覆盖七个页面、主题、图表、持仓修改、模拟买卖撤单、导入导出、规则与移动端流程 |
| `npm audit --audit-level=high`（frontend） | 升级有漏洞的开发依赖后，完整审计报告 **0 vulnerabilities** |
| `bash scripts/start.sh` + 实际 HTTP | 重启后 `/`、`/api/health`、`/api/positions`、`/api/risk-analysis` 均为 HTTP 200 |

后端测试覆盖移动平均成本、含费盈亏、Decimal 持久化、多币种换算和缺失汇率、手工成交校验与编辑删除、CSV 预检/去重/原子回滚/时间排序、风险和压力测试、模拟订单状态、同一订单并发成交、资金二次检查、A 股整手/T+1/跨交易日/时区、涨跌幅、缺失行情、规则配置、报告审计、跨站请求拒绝及不存在实盘 API。

实际模拟买入再卖出 AAPL 10 股：224.61 / 224.39 USD，买卖费各 1.00 USD，已实现亏损 4.20 USD，虚拟账户余额 99,995.80 USD。后端及浏览器均核对。此数据由隔离测试数据库产生，未写入用户默认账本。

默认实例重启后保持 6 笔持仓，演示总资产折算 CNY 1,643,206.10；验证了幂等初始化与持久化。所有价格与汇率均为虚构且标记为演示，不是实时行情。

浏览器截图：[仪表盘](screenshots/dashboard.png)、[模拟交易](screenshots/paper-trading.png)、[移动端](screenshots/mobile.png)。桌面验收同时监听 JavaScript pageerror，未出现页面运行异常；移动端检查页面无横向溢出，数据表在容器内滚动。

已保存云环境草稿字段 `install_script` 与 `start_skill`，未修改网络列表或添加凭据要求。草稿保存不等于发布；需在环境设置审阅保存后发布。未执行 Git 提交、推送或远端 CI；新文件保留在当前工作区。

功能边界与未实现项详见 README.md。本版仅单用户本机使用；无实时行情、大模型调用或真实资金交易能力。


## 本次继续完善与预览交付

- 沿用 `/workspace/elva` 的现有代码，增加深色/浅色模式（可记住偏好）、图表5/20/65日范围、鼠标/触控/滑杆交互、首页快捷入口、可下载导出与使用指南。
- 今日行情缺失时显示“暂无今日行情”，另列 `2026-10-16` 样例单日盈亏；累计盈亏含已实现和未实现。新增3个财务测试检验单日口径、手续费与成交晚于行情的边界。
- FastAPI 8000 与 React/Vite 5173 均已启动；通过 Vite 的 `/api/health` 实际代理请求得到正常结果，生产首页同源服务也正常。现有SQLite未重置。
- 已检查当前可调用工具：没有网页预览/端口转发入口，故没有生成公网地址，也未建立外部隧道。云端localhost不能作为用户电脑可打开的远程链接。
- 交付 `releases/StockPilot-演示体验.html` 和 `StockPilot-离线体验.zip`：同一React界面，独立浏览器数据层，Decimal.js资金计算。只从全新临时演示数据库打包，不读取用户账本。CSP禁止网络连接。
- 离线浏览器验收另执行同一套 **6项测试全部通过**，未发出脚本/CSS/API等额外HTTP请求，断网后仍能生成报告。由于云Chromium管理策略禁止 `file://`，使用静态HTTP加载同一HTML验证；没有绕过策略，也不声称已在本云环境中验证直接双击文件。
- 六项浏览器流程包含七页导航、深浅色切换与记忆、图表时间范围/滑杆、帮助、账户切换/刷新、观察池收藏、持仓新增编辑删除、CSV预检/错误/去重、模板与持仓CSV下载、规则合法/非法输入、报告JSON下载、模拟买卖/撤单与手机无横向页面溢出。不是穷尽所有输入的测试。
- 当前工具读取的环境配置没有待添加的密钥/变量；已更新 `install_script` 和 `start_skill` 草稿，保存确认成功、`requires_publish=true`。需用户在环境设置审阅保存并发布；发布环境不等于公开网页。离线包不依赖发布即可在用户本机体验。
- 离线和SQLite账本不自动同步，离线CSV只接受无引号模板格式；仍仅6只标的、固定虚构资金与行情，不能用作真实资产账本。无实时行情、LLM、完整交易日历或实盘连接。

最新截图：[离线深色桌面](screenshots/offline-dark.png)、[深色手机](screenshots/offline-mobile-dark.png)、[完整版深色桌面](screenshots/server-dark.png)。


## 免费真实行情与苹果式界面（2026-10-20，Asia/Shanghai）

本节优先于前述第一版演示结论。**尚未达到真实行情完整交付验收**，不宣称当前能成功从供应商取得报价。

- 沿用现有项目，增加浅灰/白色、蓝色重点色、系统字体、简洁卡片和深色模式；首页优先展示资产回溯曲线、收益与持仓分布。
- 默认联网`real`模式，新增Twelve Data日线、AKShare/东方财富日线、Frankfurter/ECB USD/CNY适配；来源、报价日期、抓取时间、延迟未知/日线状态分别显示。
- 持仓市值和盈亏只读取当前模式的真实缓存；缺股票报价或汇率时相应字段为空。单账户原币资产曲线使用同模式历史收盘数据，不回退到演示价格，不用今日汇率冒充历史汇兑。
- 隔离测试结果：**64项后端测试通过**；覆盖原有财务、缓存失败保留、缺数据不回退、日期/币种/标的校验、来源精度、AKShare成交量手→股、分钟/日预算、退避和凭据变化、真实缓存估值与原币曲线。供应商响应是测试夹具，未写入用户真实缓存，不算实网验证。
- 浏览器**8项用例通过**：保留6项原页面流程，新增真实模式缺报价/汇率不回退、资产配置缺失状态、行情状态、显式切换、MIT不能替代上游许可、无付费订阅行为和手机布局检查。TypeScript、ESLint、生产构建通过，Python依赖检查通过。
- 实例FastAPI8000和React/Vite5173已启动，5173的/api代理健康请求成功，market_provider=real、live_trading=false。只在本机监听，没有公开部署。
- 实际执行POST /api/market-data/refresh的结果：**0个真实股票缓存、0个真实汇率缓存**。服务器无TWELVE_DATA_API_KEY；A股上游个人使用依据未核实而禁用；Frankfurter HTTPS请求被代理拒绝。此前直接读取Twelve官网/条款及ECB条款也收到代理403，不能宣称已核对最新免费配额或公开展示许可。
- 已保存所需网络域名、TWELVE_DATA_API_KEY安全需求，以及更新后的安装和启动草稿，工具确认saved、requires_publish=true。草稿尚需用户保存发布/应用；不等于当前网络或密钥已生效。
- 等待环境网络与密钥生效后，需要继续读取官方条款、核对账户免费权益及A股授权，再用真实响应完成价格/时间/币种/汇率和持仓估值验收。没有购买服务、开通付费计划、连接券商或实盘交易。

许可依据和精确阻塞见[DATA_SOURCES.md](DATA_SOURCES.md)。截图：[苹果式真实模式缺失状态](screenshots/apple-real-pending.png)、[手机行情连接页](screenshots/apple-source-mobile.png)。截图没有把测试夹具伪装成真实行情。


## GitHub 整理与 Vercel 演示构建（2026-10-20，Asia/Shanghai）

- 本轮暂停新增业务功能和真实行情接入；只整理源码、部署配置、说明及相关验证。
- `npm --prefix frontend run build:vercel` 复用既有浏览器演示数据层，输出多文件静态站点。`vercel.json` 指定安装、构建、发布目录与安全响应头；不部署FastAPI、SQLite、真实行情或任何密钥。每个访客的修改保存在自己的浏览器。
- 从全新临时数据库重新导出虚构种子，未读取 `data/stockpilot.db`。Git与Vercel忽略数据库、环境文件、凭据、缓存、依赖、生成文件和截图。
- 64项后端测试、Ruff、TypeScript、ESLint与演示生产构建通过。
- 使用与Vercel相同的静态构建产物和安全响应头，6项浏览器流程全部通过，覆盖七页、桌面/手机、深浅主题、图表、诊断/报告、观察池、风控、CSV、模拟买卖/撤单。未请求后端或外部数据源，断网后报告仍可生成。
- 上传前对Git暂存区的精确副本执行Gitleaks 8.30.1全量扫描，未发现密钥；另检查不含数据库、环境值或生成二进制。扫描结果不等于对所有未来提交的保证。
- 当前Vercel官网/API请求被网络代理拒绝 CONNECT 403；CLI未登录。尚未生成或验证Vercel线上网页；不能将上述本机测试描述为已经上线。具体免费部署步骤见 `docs/VERCEL_DEPLOY.md`。
