import { BookOpen, ChevronRight, CircleHelp, FlaskConical, Shield } from "lucide-react";

type Navigate = (page: number) => void;

const pageGuides = [
  { headline: "从这里开始：先看懂收益、风险，再考虑配置", explain: "首页的数字回答三个问题：我赚了还是亏了？有哪些需要注意的风险？现金与股票各占多少？先理解含义，不必急着操作。" },
  { headline: "我的持仓：看看现在拥有哪些股票", explain: "先核对股票代码、持有数量和成本。仓位是某只股票占总资产的比例，不是越高越好。" },
  { headline: "持仓诊断：了解风险，不预测涨跌", explain: "分析结果使用预设规则和历史样例。持有、减仓、退出只是情景对比，不是要求你买卖的指令。" },
  { headline: "股票研究：指标是线索，不是答案", explain: "均线、RSI 和历史波动描述过去的价格表现；它们不能保证未来涨跌。先学会看来源和日期。" },
  { headline: "模拟交易：用虚拟资金练习完整流程", explain: "这是不连接券商的练习功能。先理解买入、卖出、手续费与风险，再体验模拟成交；不会产生真实证券交易。" },
  { headline: "风控中心：学习给自己设定边界", explain: "关注单股上限、行业集中度、现金缓冲和亏损阈值。触发提示意味着需要检查，不等于系统知道未来行情。" },
  { headline: "导入与设置：先用演示模板练习", explain: "这个公开演示网页只有浏览器本地数据，不是安全的真实券商账本。请勿在这里导入包含身份、账号或真实资产信息的券商原始文件。" },
];

const terms = [
  { name: "累计盈亏", detail: "把已经卖出赚亏的金额和还持有股票的账面赚亏加起来；数值为负表示亏损。它不包含所有可能的税费和分红。" },
  { name: "收益率", detail: "用百分比表达投入资金的收益情况。这里按现有账本规则计算，不是年化收益，也不代表未来收益。" },
  { name: "浮动盈亏", detail: "股票还没卖出，按当前可用价格与持有成本计算的账面赚亏；价格变化时会改变。" },
  { name: "仓位", detail: "一只股票或某个行业占你总资产的比例。过于集中，单一价格波动的影响可能更大。" },
  { name: "回撤", detail: "历史价格从高点下降了多少，只描述过去发生的下跌，不是未来最坏损失的上限。" },
  { name: "现金底线", detail: "你事先设定的最低现金比例。低于它时系统会提醒复核流动性，不是自动要求卖出股票。" },
  { name: "MA20 / RSI", detail: "MA20是最近20个交易日收盘价的简单平均；RSI是价格涨跌动量指标。两者都不能保证判断准确。" },
  { name: "风险提醒", detail: "当仓位、波动、数据时效等超过既定条件时出现的检查提示。没有提醒也不代表没有风险。" },
];

const learningSteps = [
  { label: "第 1 步", title: "读懂收益", detail: "认识盈亏与收益率", page: 0, icon: BookOpen },
  { label: "第 2 步", title: "认识风险", detail: "查明提醒从何而来", page: 5, icon: Shield },
  { label: "第 3 步", title: "模拟练习", detail: "只用虚拟资金学习", page: 4, icon: FlaskConical },
];

export function BeginnerGuide({
  page,
  navigate,
  demo,
}: {
  page: number;
  navigate: Navigate;
  demo: boolean;
}) {
  const guide = pageGuides[page] ?? pageGuides[0];
  return (
    <section className="beginner-guide" aria-label="新手学习指南">
      <div className="beginner-guide-heading">
        <span className="beginner-guide-icon"><BookOpen size={18} aria-hidden="true" /></span>
        <div>
          <strong>{guide.headline}</strong>
          <p>{guide.explain}</p>
        </div>
      </div>
      {page === 0 && (
        <div className="beginner-learning-steps" aria-label="新手三步学习路线">
          {learningSteps.map((step) => (
            <button
              type="button"
              key={step.label}
              onClick={() => navigate(step.page)}
              aria-label={`${step.label}：${step.title}`}
            >
              <step.icon size={18} aria-hidden="true" />
              <span>
                <small>{step.label}</small>
                <strong>{step.title}</strong>
                <em>{step.detail}</em>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <details className="beginner-glossary">
        <summary><CircleHelp size={17} aria-hidden="true" /> 不懂这些词？打开股票小词典</summary>
        <dl>
          {terms.map((term) => (
            <div key={term.name}>
              <dt>{term.name}</dt>
              <dd>{term.detail}</dd>
            </div>
          ))}
        </dl>
      </details>
      <p className="beginner-data-note">
        {demo
          ? "你看到的是虚构的演示行情和初始持仓，不代表你的真实收益；请先学习，再考虑是否接入安全的数据来源。"
          : "即使使用真实行情，账户也可能仍含演示持仓；请核对时间、来源与成本再作判断。"}
        {" "}这里不会替你作出买卖决定。
      </p>
    </section>
  );
}
