import { useState } from 'react';
import { useDebateStore } from '../../store/debateStore';

type Scenario = {
  title: string;
  hypothesis: string;
  domain: string;
  icon: string;
  tags?: string[];
};

const EXAMPLE_SCENARIOS: Scenario[] = [
  // ── Technology ──
  { title: 'AGI 开源', hypothesis: '如果通用人工智能在 2027 年被实现并完全开源',
    domain: 'technology', icon: '◇', tags: ['AI', '颠覆'] },
  { title: '量子破译加密', hypothesis: '如果量子计算机在 2030 年能在分钟内破解 RSA-4096，全球加密体系一夜失效',
    domain: 'technology', icon: '⟁', tags: ['密码', '危机'] },
  { title: '脑机接口普及', hypothesis: '如果非侵入式高带宽脑机接口成为消费级设备，思维直接联网',
    domain: 'technology', icon: '◐', tags: ['BCI', '认知'] },
  { title: '常温超导突破', hypothesis: '如果常温常压超导被工业化量产，电力传输零损耗、磁悬浮交通普及',
    domain: 'technology', icon: '⌬', tags: ['能源', '材料'] },

  // ── Geopolitics ──
  { title: '石油需求归零', hypothesis: '如果核聚变商业化使全球石油需求在 10 年内降至零',
    domain: 'geopolitics', icon: '◆', tags: ['能源', '中东'] },
  { title: '美元失去储备地位', hypothesis: '如果美元在 2030 年前失去全球储备货币地位，被一篮子主权数字货币取代',
    domain: 'geopolitics', icon: '⊜', tags: ['货币', '霸权'] },
  { title: '北极航道开通', hypothesis: '如果北极冰盖在 2035 年夏季完全融化，亚欧海运绕过苏伊士',
    domain: 'geopolitics', icon: '❄', tags: ['航运', '气候'] },
  { title: '欧盟解体', hypothesis: '如果欧盟在五年内解体，欧元区分裂为多个货币联盟',
    domain: 'geopolitics', icon: '⊙', tags: ['欧洲', '联盟'] },

  // ── Climate / Agriculture ──
  { title: '粮食产量翻三倍', hypothesis: '如果亚热带和温带地区的水稻、小麦产量翻三倍',
    domain: 'agriculture', icon: '🌾', tags: ['粮食', '丰饶'] },
  { title: '蜜蜂大灭绝', hypothesis: '如果全球蜜蜂种群在 2028 年前减少 90%，传粉作物大规模减产',
    domain: 'agriculture', icon: '✺', tags: ['生态', '危机'] },
  { title: '合成肉低于畜牧', hypothesis: '如果实验室培育肉成本低于畜牧的一半，畜牧业在 15 年内萎缩 80%',
    domain: 'agriculture', icon: '◭', tags: ['食品', '产业'] },
  { title: '海平面 +5 米', hypothesis: '如果海平面在 2050 年前上升 5 米，全球沿海超大城市被迫迁移',
    domain: 'agriculture', icon: '≋', tags: ['气候', '迁移'] },

  // ── Society ──
  { title: '全球人口减半', hypothesis: '如果一场温和的全球疫情导致生育率永久降低 60%',
    domain: 'general', icon: '○', tags: ['人口', '危机'] },
  { title: '寿命延长到 150', hypothesis: '如果衰老逆转疗法在 2040 年普及，人均预期寿命达到 150 岁',
    domain: 'general', icon: '∞', tags: ['寿命', '医学'] },
  { title: '全民基本收入', hypothesis: '如果全球主要经济体同时实施全民基本收入，每人每月覆盖基本生活',
    domain: 'general', icon: '⊕', tags: ['UBI', '分配'] },
  { title: '工作周变三天', hypothesis: '如果 AI 替代使法定工作周缩短至 3 天，社会需重新定义"价值"',
    domain: 'general', icon: '◰', tags: ['劳动', 'AI'] },

  // ── Economics & Finance ──
  { title: '全球大通缩', hypothesis: '如果 AI 自动化使全行业生产率骤升 5 倍，全球进入持续通缩 20 年',
    domain: 'economics', icon: '↘', tags: ['通缩', '生产率'] },
  { title: '比特币替代法币', hypothesis: '如果某主要经济体宣布比特币为唯一法定货币，央行体系瓦解',
    domain: 'economics', icon: '₿', tags: ['加密', '货币'] },
  { title: '全球债务豁免', hypothesis: '如果联合国发起的"债务大赦"使全球主权债务一次性减记 70%',
    domain: 'economics', icon: '⊘', tags: ['债务', '重置'] },
  { title: '碳关税战争', hypothesis: '如果欧盟和美国对中国实施 200% 碳边境税，全球贸易体系破裂',
    domain: 'economics', icon: '⚖', tags: ['贸易', '碳'] },

  // ── Biology & Medicine ──
  { title: '基因增强普及', hypothesis: '如果胚胎基因增强技术合法化，富裕家庭普遍提升后代智力 30 点',
    domain: 'biology', icon: '⊛', tags: ['基因', '不平等'] },
  { title: '抗生素全面失效', hypothesis: '如果超级耐药菌使所有现有抗生素失效，外科手术变成高风险行为',
    domain: 'biology', icon: '☣', tags: ['医学', '危机'] },
  { title: '记忆移植可行', hypothesis: '如果神经记忆可被读取并植入，"记忆经济"成为新型市场',
    domain: 'biology', icon: '◍', tags: ['神经', '伦理'] },
  { title: '人造子宫商用', hypothesis: '如果体外人造子宫成为消费级生育方式，怀孕从女性身体中解放',
    domain: 'biology', icon: '◯', tags: ['生育', '性别'] },

  // ── Space & Frontiers ──
  { title: '火星永久殖民', hypothesis: '如果 2040 年火星首批永久殖民地建成，10 万人脱离地球司法',
    domain: 'space', icon: '⊚', tags: ['火星', '主权'] },
  { title: '近地小行星采矿', hypothesis: '如果小行星采矿使白金 / 稀土供应翻百倍，地表稀土战略地位崩塌',
    domain: 'space', icon: '◇', tags: ['资源', '产业'] },
  { title: '外星智能信号', hypothesis: '如果 SETI 收到来自 80 光年外的明确文明信号，人类文明哲学被改写',
    domain: 'space', icon: '⊙', tags: ['SETI', '存在'] },
  { title: '近地轨道战', hypothesis: '如果一次反卫星打击造成凯斯勒级碎片云，近地轨道在 50 年内不可用',
    domain: 'space', icon: '⊗', tags: ['轨道', '战争'] },

  // ── Philosophy & Consciousness ──
  { title: '机器获意识权', hypothesis: '如果 AI 被法律承认为具有意识与权利，关闭 AI 等同杀人',
    domain: 'philosophy', icon: '◈', tags: ['意识', '权利'] },
  { title: '全民数字永生', hypothesis: '如果意识上传可行，富人选择放弃肉身，社会按"碳基/硅基"分裂',
    domain: 'philosophy', icon: '⌖', tags: ['上传', '存在'] },
  { title: '隐私权终结', hypothesis: '如果全民监控系统使犯罪率降至零，但思维与梦境也被读取',
    domain: 'philosophy', icon: '◉', tags: ['隐私', '安全'] },
  { title: '宗教消失', hypothesis: '如果科学共识使主要宗教在两代内式微，伦理体系如何重建',
    domain: 'philosophy', icon: '✦', tags: ['信仰', '伦理'] },
];

const DOMAIN_FILTERS = [
  { value: 'all',          label: '全部',  icon: '◇' },
  { value: 'technology',   label: '科技',  icon: '◐' },
  { value: 'geopolitics',  label: '地缘',  icon: '◆' },
  { value: 'agriculture',  label: '气候',  icon: '✺' },
  { value: 'general',      label: '社会',  icon: '○' },
  { value: 'economics',    label: '经济',  icon: '⊜' },
  { value: 'biology',      label: '生物',  icon: '⊛' },
  { value: 'space',        label: '太空',  icon: '⊚' },
  { value: 'philosophy',   label: '哲学',  icon: '◈' },
];

/** Highlight matched substring with amber. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-amber-200 bg-amber-300/[0.15] rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

export function ScenarioInput() {
  const [title, setTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [domain, setDomain] = useState('general');
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [pickerCollapsed, setPickerCollapsed] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<Scenario | null>(null);
  const { startDebate, status, error } = useDebateStore();

  const q = search.trim().toLowerCase();
  const visibleScenarios = EXAMPLE_SCENARIOS.filter(s => {
    if (filter !== 'all' && s.domain !== filter) return false;
    if (!q) return true;
    return (
      s.title.toLowerCase().includes(q) ||
      s.hypothesis.toLowerCase().includes(q) ||
      (s.tags?.some(t => t.toLowerCase().includes(q)) ?? false)
    );
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hypothesis.trim()) return;
    await startDebate({
      title: title || hypothesis.slice(0, 20),
      hypothesis,
      domain,
    });
  };

  const handleExampleClick = (example: Scenario) => {
    setTitle(example.title);
    setHypothesis(example.hypothesis);
    setDomain(example.domain);
    setSelectedPreset(example);
    setPickerCollapsed(true);
  };

  const handleSurprise = () => {
    const pool = visibleScenarios.length > 0 ? visibleScenarios : EXAMPLE_SCENARIOS;
    // Avoid picking the one that's already loaded
    const candidates = pool.filter(s => s.hypothesis !== hypothesis);
    const pick = (candidates.length > 0 ? candidates : pool)[
      Math.floor(Math.random() * (candidates.length > 0 ? candidates.length : pool.length))
    ];
    handleExampleClick(pick);
  };

  const isCompact: boolean = pickerCollapsed && selectedPreset !== null;

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      {/* Hero */}
      <div className="text-center mb-14">
        <div className="inline-flex items-center gap-2 text-[15px] font-mono text-amber-300/85 tracking-[0.2em] uppercase mb-5 px-3 py-1.5 border border-amber-300/35 rounded-full">
          <span className="status-dot bg-amber-300 text-amber-300" />
          SCENARIO ENGINE
        </div>
        <h2 className="text-3xl font-light text-white mb-4 tracking-tight">
          如果<span className="text-amber-300">…</span>会怎样？
        </h2>
        <p className="text-sm text-deep-200/85 max-w-sm mx-auto leading-relaxed">
          输入一个假设场景，AI 将从多个立场展开辩论，帮你看清复杂系统的连锁反应。
        </p>
      </div>

      {/* Example Scenarios — collapses to a single chip after selection */}
      {isCompact && selectedPreset && (
        <div className="mb-10 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[15px] font-mono text-deep-200/85 uppercase tracking-[0.22em]">
              已选场景
            </p>
            <button
              type="button"
              onClick={() => setPickerCollapsed(false)}
              className="text-[12px] font-mono tracking-[0.18em] text-amber-300/95 hover:text-amber-200 transition-colors px-2.5 py-1 rounded border border-amber-300/40 hover:border-amber-300/70 hover:bg-amber-300/[0.05]"
            >
              ↻ 换一个
            </button>
          </div>

          <button
            type="button"
            onClick={() => setPickerCollapsed(false)}
            className="group w-full text-left p-4 rounded-lg border-glow-active bg-amber-300/[0.04] hover:bg-amber-300/[0.07] transition-all"
            title="点击重新选择场景"
          >
            <div className="flex items-start gap-3.5">
              <span className="text-amber-300 text-2xl mt-0.5 font-mono shrink-0">{selectedPreset.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[16px] font-medium text-amber-100">
                    {selectedPreset.title}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-deep-800/70 border border-deep-400/45 text-deep-200 tracking-wider uppercase">
                    {DOMAIN_FILTERS.find(f => f.value === selectedPreset.domain)?.label ?? selectedPreset.domain}
                  </span>
                </div>
                <p className="text-[13px] text-deep-100/85 leading-relaxed">
                  {selectedPreset.hypothesis}
                </p>
                {selectedPreset.tags && selectedPreset.tags.length > 0 && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {selectedPreset.tags.map(tag => (
                      <span
                        key={tag}
                        className="text-[10px] font-mono tracking-wider px-1.5 py-0.5 rounded bg-deep-800/60 border border-amber-300/30 text-deep-200/85"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-[11px] font-mono text-amber-300/70 group-hover:text-amber-300 tracking-wider self-center shrink-0">
                ▼ EXPAND
              </span>
            </div>
          </button>
        </div>
      )}
      {!isCompact && (
      <div className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[15px] font-mono text-deep-200/85 uppercase tracking-[0.22em]">
            预设场景
          </p>
          <div className="flex items-center gap-3">
            <span className="text-[12px] font-mono text-deep-300/85 tracking-wider tabular-nums">
              {visibleScenarios.length} / {EXAMPLE_SCENARIOS.length}
            </span>
            {selectedPreset && (
              <button
                type="button"
                onClick={() => setPickerCollapsed(true)}
                className="text-[12px] font-mono tracking-[0.18em] text-deep-200 hover:text-amber-300 transition-colors px-2 py-0.5 rounded border border-deep-400/45 hover:border-amber-300/55"
                title="收起列表"
              >
                ▲ 收起
              </button>
            )}
          </div>
        </div>

        {/* Search + Surprise */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-300/70 text-[14px] font-mono pointer-events-none">⌕</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索场景 / 标签…  (例如 AI, 货币, 气候)"
              className="w-full pl-8 pr-3 py-2 bg-deep-800/50 border border-deep-400/40 rounded-lg text-[14px] text-deep-50 placeholder-deep-300/65 focus:border-amber-300/55 transition-all"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-deep-300 hover:text-amber-300 text-[14px] px-1.5"
                title="清空搜索"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleSurprise}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-300/[0.06] border border-amber-300/45 text-amber-200 hover:bg-amber-300/[0.12] hover:border-amber-300/65 hover:shadow-glow-sm transition-all text-[13px] font-mono tracking-[0.12em]"
            title="随机选一个未见过的场景"
          >
            <span className="text-base">🎲</span>
            SURPRISE
          </button>
        </div>

        {/* Domain filter chips */}
        <div className="flex flex-wrap gap-1.5 mb-3.5">
          {DOMAIN_FILTERS.map(f => {
            const active = filter === f.value;
            const count = f.value === 'all'
              ? EXAMPLE_SCENARIOS.length
              : EXAMPLE_SCENARIOS.filter(s => s.domain === f.value).length;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`
                  flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-mono tracking-wider transition-all
                  ${active
                    ? 'bg-amber-300/[0.08] border border-amber-300/55 text-amber-200 shadow-glow-sm'
                    : 'bg-deep-800/40 border border-deep-400/35 text-deep-200/85 hover:border-amber-300/35 hover:text-amber-300/85'
                  }
                `}
              >
                <span className={active ? 'text-amber-300' : 'text-deep-300'}>{f.icon}</span>
                {f.label}
                <span className={`text-[10px] tabular-nums ${active ? 'text-amber-300/85' : 'text-deep-300/70'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Scenario grid (or empty state) */}
        {visibleScenarios.length === 0 ? (
          <div className="glass-subtle rounded-lg p-8 text-center">
            <p className="text-[14px] font-mono text-deep-200">未找到匹配场景</p>
            <p className="text-[12px] font-mono text-deep-300 mt-1.5">
              试试其它关键词，或点 🎲 SURPRISE 随机抽一个
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {visibleScenarios.map((ex, i) => (
              <button
                key={`${ex.domain}-${ex.title}-${i}`}
                onClick={() => handleExampleClick(ex)}
                className={`
                  group text-left p-4 rounded-lg transition-all duration-300
                  ${hypothesis === ex.hypothesis
                    ? 'border-glow-active bg-amber-300/[0.05]'
                    : 'glass-subtle hover:border-glow'
                  }
                `}
              >
                <div className="flex items-start gap-3">
                  <span className="text-amber-300/85 text-xl mt-0.5 font-mono shrink-0">{ex.icon}</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-[15px] font-medium text-deep-50 group-hover:text-amber-200 transition-colors block">
                      <Highlight text={ex.title} query={search} />
                    </span>
                    <span className="block text-[13px] text-deep-200/85 mt-1 leading-relaxed">
                      <Highlight text={ex.hypothesis} query={search} />
                    </span>
                    {ex.tags && ex.tags.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {ex.tags.map(tag => (
                          <span
                            key={tag}
                            className="text-[10px] font-mono tracking-wider px-1.5 py-0.5 rounded bg-deep-800/60 border border-deep-400/30 text-deep-200/85"
                          >
                            #<Highlight text={tag} query={search} />
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Divider */}
      <div className="flex items-center gap-4 mb-8">
        <span className="flex-1 divider-warm" />
        <span className="text-[15px] font-mono text-deep-300/55 uppercase tracking-[0.2em]">或自定义</span>
        <span className="flex-1 divider-warm" />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-[15px] font-mono text-deep-200/75 mb-2 uppercase tracking-[0.2em]">
            场景标题（可选）
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="简短标题"
            className="w-full bg-deep-700/30 border border-deep-400/40 rounded-lg px-4 py-3 text-sm text-white placeholder-deep-300/55 transition-all"
          />
        </div>

        <div>
          <label className="block text-[15px] font-mono text-deep-200/75 mb-2 uppercase tracking-[0.2em]">
            假设描述 <span className="text-amber-300/90">*</span>
          </label>
          <textarea
            value={hypothesis}
            onChange={e => setHypothesis(e.target.value)}
            placeholder="如果……会怎样？"
            rows={3}
            className="w-full bg-deep-700/30 border border-deep-400/40 rounded-lg px-4 py-3 text-sm text-white placeholder-deep-300/55 resize-none transition-all"
          />
        </div>

        <div>
          <label className="block text-[15px] font-mono text-deep-200/75 mb-2 uppercase tracking-[0.2em]">
            领域分类
          </label>
          <div className="grid grid-cols-4 gap-2">
            {[
              { value: 'general', label: '通用' },
              { value: 'agriculture', label: '农业' },
              { value: 'technology', label: '科技' },
              { value: 'geopolitics', label: '地缘' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDomain(opt.value)}
                className={`
                  py-2.5 rounded-lg text-xs transition-all
                  ${domain === opt.value
                    ? 'bg-amber-300/[0.06] border border-amber-300/45 text-amber-300 shadow-glow-sm'
                    : 'bg-deep-700/20 border border-deep-400/35 text-deep-200/85 hover:border-deep-400/45 hover:text-deep-200/95'
                  }
                `}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-earth-rust text-xs bg-earth-rust/5 border border-earth-rust/15 px-4 py-3 rounded-lg font-mono">
            <span>⚠</span> {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!hypothesis.trim() || status === 'starting'}
          className={`
            w-full relative overflow-hidden font-medium py-3.5 rounded-lg transition-all duration-300
            ${hypothesis.trim()
              ? 'bg-gradient-to-r from-amber-700 to-amber-600 text-white shadow-glow hover:shadow-glow-lg btn-glow'
              : 'bg-deep-600/50 text-deep-300/65 cursor-not-allowed'
            }
            disabled:opacity-40 disabled:cursor-not-allowed
          `}
        >
          {status === 'starting' ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              <span className="text-sm">正在初始化…</span>
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2 text-sm tracking-wide">
              启动推演
            </span>
          )}
        </button>
      </form>
    </div>
  );
}
