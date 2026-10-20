# Vercel 免费演示部署

此指南部署现有 React 界面和虚构演示数据，保留苹果式中文界面、深浅主题、手机布局、图表、持仓诊断、风险预警、CSV 导入导出和模拟交易。它是通过 HTTPS 打开的交互网页，不需要在电脑安装 Python 或 Node。

## 部署范围

- 使用 Vercel **Hobby 免费方案**，仅作个人、非商业演示。Hobby 的适用范围和额度以部署时的官方条款为准；不要开通 Pro、试用付费套餐、付费附加项或超额付费服务。
- 复用项目已有的浏览器演示数据层，所有价格、汇率、账户和初始成交都是虚构样例。没有接入行情供应商、证券账户、真实交易或付费 AI。
- 只发布 `frontend/dist`。完整 FastAPI 源码保留在仓库，但本次 Vercel 不部署 Python API 或 SQLite。SQLite 文件不是 Vercel 静态托管的持久化数据库。
- 导入、修改、模拟交易和报告在访客自己的浏览器中处理、保存，不上传服务器，不与其他访客或本地 FastAPI 账本同步。清理浏览器数据会丢失修改，先导出备份。此部署不适合多人协作或正式投资记账。
- 不需要设置任何 API 密钥。不要把真实持仓、环境文件、密钥或数据库上传到 GitHub/Vercel。

## 方法一：网页操作，推荐

1. 打开 [Vercel 注册/登录](https://vercel.com/signup)，使用拥有此仓库访问权的 GitHub 账户登录。选择个人 **Hobby** 免费账户；不要启用 Pro 试用。
2. 打开 [导入 GitHub 项目](https://vercel.com/new)。如果没有看到 `flselva251215-ship-it/elva`，通过页面上的 GitHub 集成设置，只授权这个仓库，再返回导入页。
3. 找到 **elva**，点 **Import**。项目名可用 `ai-stockpilot`，名称已被占用时换一个。
4. **Root Directory 保持仓库根目录 `.`，不要选 `frontend`**。框架选 **Other**。根目录中的 `vercel.json` 已配置下面三项；页面若没有自动读取，请打开对应 Override 并填写：

   | 设置 | 内容 |
   |---|---|
   | Install Command | `npm --prefix frontend ci` |
   | Build Command | `npm --prefix frontend run build:vercel` |
   | Output Directory | `frontend/dist` |
   | Production Branch | `main` |

5. **Environment Variables 留空**。不填写 Twelve Data、OpenAI、券商密钥或任何真实账户信息。默认 Vercel 子域名即可，不购买域名或服务。
6. 点 **Deploy**。等状态变为 **Ready** 后点 **Visit**。复制浏览器实际打开的 HTTPS 地址，或在项目的 Domains 中复制实际分配的域名。不要根据项目名猜测网址。
7. 在手机和电脑各打开一次该地址，按下面的验收清单点击。若访客遇到 Vercel 登录页，检查 Deployment Protection；公开演示应分享允许访客访问的生产域名，同时保持 GitHub 源码、构建日志和环境变量的访问限制。不要发布真实持仓内容。
8. GitHub 连接成功后，后续推送到 `main` 会触发新部署。以 Vercel 的 Ready 状态和实际页面为准；代码推送成功不代表网站已发布。

## 方法二：已有授权的 Vercel CLI

仅适用于自己电脑已经安装 Node.js 且愿意使用命令行的用户。不需要给本项目增加 Vercel 依赖。

```bash
git clone https://github.com/flselva251215-ship-it/elva.git
cd elva
npx vercel@64.7.0 login
npx vercel@64.7.0 --prod
```

选择个人 Hobby 账户，连接现有项目或创建演示项目，Root Directory 保持当前仓库根目录，使用 `vercel.json` 的配置。登录在 Vercel 官方页面完成；不要把登录令牌贴进聊天、命令参数、源码或仓库。CLI 输出的已就绪 Deployment/Production URL 才是待验收地址。

如果当前机器受限，须先允许访问 `vercel.com`、`api.vercel.com` 及实际生成的 `*.vercel.app` 站点。网络放行与账户登录是独立条件；保存配置草稿不等于网络已经生效或完成授权。

## 发布后点击验收

1. 首页有“演示环境”“全部行情、汇率和初始资产均为虚构样例”，可以看到美股、A 股和收益数据。
2. 切换深色模式、账户、图表时间范围和滑杆；手机页面可以操作。
3. “我的持仓”搜索贵州茅台，点分析，生成报告并下载 JSON。
4. “股票研究”添加/取消收藏；“风控中心”修改并保存规则。
5. “模拟交易”选择美元账户和 AAPL，勾选历史演示时钟，创建并模拟成交，随后卖出或撤单。此流程只影响浏览器内的虚拟账本。
6. “导入与设置”下载 CSV 模板，使用虚构数据校验预览、确认导入，再导出持仓；刷新页面后应保留本浏览器修改。
7. 页面不应出现“请确认后端运行”、API 连接错误或真实行情已连接的表述。浏览器演示不应请求 `/api` 或行情服务。

## 常见问题

- **页面空白 / 提示后端未启动**：确认 Build Command 是 `build:vercel`，而不是普通 `build`；确认根目录是仓库根目录；重新部署最新 `main`。
- **构建找不到 package.json**：本仓库的清单在 `frontend`，安装命令必须含 `--prefix frontend`，输出为 `frontend/dist`。
- **部署失败**：打开 Deployment 的 Build Logs，检查第一条实际错误。日志仅供授权人员查看，分享前遮蔽账户标识及任何凭据。不要为了修复错误购买服务。
- **不同电脑数据不同**：这是预期行为；本演示保存在各自浏览器中，没有云端共享数据库。
- **真实行情入口不可用**：本次刻意只部署既有演示，不继续真实行情接入；真实数据许可和稳定性仍需单独核实。

官方参考：[Hobby](https://vercel.com/docs/plans/hobby)、[导入项目](https://vercel.com/docs/getting-started-with-vercel/import)、[项目配置](https://vercel.com/docs/project-configuration)、[Vite 部署](https://vercel.com/docs/frameworks/frontend/vite)。本受限环境未能联网复核这些页面的最新条款，故不承诺固定免费额度；部署前以官方页面与账户显示为准。
