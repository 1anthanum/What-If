/**
 * 20 个精选反直觉哲学议题，分 5 类。
 * 每个 preset 故意带「钩子」 —— 让 5 位 persona 的思维传统会真正撕扯起来，
 * 而不是各自给一段教科书答案。
 */

export interface PhilosophicalPreset {
  id: string;
  title: string;
  question: string;
  category:
    | 'classic'          // contemporary thought experiments
    | 'consciousness'    // mind / identity
    | 'agency'           // free will
    | 'ai_ethics'        // AI / tech ethics
    | 'meta'             // brain-twister metaethics
    | 'ancient_west'     // Plato / Aristotle / Stoics
    | 'ancient_east'     // Confucius / Dao / Buddhist
    | 'political'        // political philosophy
    | 'epistemology'     // knowledge / truth
    | 'aesthetics';      // meaning / beauty / art
  hook: string;       // 为什么这个题反直觉 —— 一句钩子描述
  /** Suggested difficulty for classroom use. Defaults to 'intermediate'. */
  difficulty?: 'intro' | 'intermediate' | 'advanced';
  /** Classical source / thinker this preset traces back to. */
  classical_source?: string;
}

export const PHILOSOPHICAL_PRESETS: PhilosophicalPreset[] = [
  // ─── 经典思想实验（被新场景重新激活）───────────
  {
    id: 'theseus_self',
    category: 'classic',
    title: '🚢 神经元忒修斯',
    question: '如果你的神经元被一个个替换为功能完全相同的硅芯片，到第几个你不再是"你"？还是说"自我同一性"本来就是个错觉？',
    hook: '强迫定义"你"的边界 —— 是物理基质？是因果链？还是叙事记忆？',
  },
  {
    id: 'eternal_return',
    category: 'classic',
    title: '♾ 永恒回归的伦理',
    question: '如果你必须无限次重复经历你的整段人生（每个细节、每个选择都一样），你愿意吗？这种意愿本身是否定义了"美好生活"？',
    hook: '尼采的镜子 —— 暴露你对自己生活的真实评价，而非你声称的评价',
  },
  {
    id: 'utopia_pain',
    category: 'classic',
    title: '🏝 完美乌托邦的代价',
    question: '一个永远没有任何痛苦、不公、苦难的社会，但代价是没有任何挑战、奋斗、超越 —— 这是天堂还是地狱？人类需要苦难吗？',
    hook: '《美丽新世界》核心命题 —— 揭示"幸福"是否就是终极目的',
  },
  {
    id: 'simulation_argument',
    category: 'classic',
    title: '🎮 模拟假说的不对称',
    question: '如果你 99% 确信我们生活在模拟里，你的道德选择应该改变吗？如果模拟者道德上比我们高，"听他们的"是否就是正确？',
    hook: '不是问"是不是模拟"，而是问"如果是，怎么活" —— 把形而上学问题转化为伦理问题',
  },

  // ─── 意识与同一性 ──────────────────────────
  {
    id: 'split_consciousness',
    category: 'consciousness',
    title: '🧠 分裂的意识',
    question: '如果你的左右脑被分别上传到两台机器各自独立运行，哪一个才是"原来的你"？两个都是？两个都不是？',
    hook: '帕菲特的难题 —— 揭示"个人同一性"可能不是黑白的二元概念',
  },
  {
    id: 'p_zombie',
    category: 'consciousness',
    title: '🧟 哲学僵尸的悖论',
    question: '一个外在行为与你完全一致、但内心毫无主观体验（"内在黑暗"）的存在 —— 它是否可能存在？如果可能，意识就是物理上多余的；如果不可能，意识就必然源于物质。',
    hook: 'Chalmers 的硬问题 —— 揭示意识与物理之间的解释鸿沟',
  },
  {
    id: 'collective_mind',
    category: 'consciousness',
    title: '🌐 100 万脑融合',
    question: '如果通过脑机将 100 万人脑实时连接成一个共享意识，那是 100 万个人，还是 1 个人？决策时该按 100 万次表决，还是按 1 个意志？',
    hook: '把"个体"概念推到极限 —— 暴露我们的政治哲学全部默认了原子化个体',
  },
  {
    id: 'memory_swap',
    category: 'consciousness',
    title: '📼 记忆调换',
    question: '如果你和陌生人完全调换记忆但身体不变 —— 谁该为你之前犯的错负责？身份属于身体还是记忆？',
    hook: '洛克的记忆理论 vs 物理连续性 —— 法律和道德实际上选择了哪一边？',
  },

  // ─── 自由意志与决定论 ─────────────────────
  {
    id: 'perfect_prediction',
    category: 'agency',
    title: '🔮 完美预测之囚',
    question: '如果有人能 100% 准确预测你下一秒的所有选择（且不告诉你预测内容），你还有自由意志吗？如果他告诉你，你能违背预测吗？',
    hook: 'Newcomb 问题的现代版 —— 揭示"自由"的定义是否依赖于"不可预测"',
  },
  {
    id: 'libet',
    category: 'agency',
    title: '⏱ 决策的延迟',
    question: '如果脑科学证明你的"决定"在意识感知之前 0.5 秒就已经在大脑里形成了 —— 那"我做了决定"是不是一种事后构造的幻觉？',
    hook: 'Libet 实验的哲学冲击 —— 挑战意识的因果作用',
  },
  {
    id: 'moral_luck',
    category: 'agency',
    title: '🎲 道德运气',
    question: '两人都酒驾，一个安全到家，另一个撞死了行人 —— 两人在道德上同样有罪吗？如果是，"结果"在道德判断中应该几乎不重要；如果不是，道德就是部分由运气决定的。',
    hook: 'Williams 的运气难题 —— 暴露我们的道德直觉的内在不一致',
  },
  {
    id: 'time_travel_responsibility',
    category: 'agency',
    title: '🕰 因果倒流的责任',
    question: '如果时间可以倒流，过去事件是否还"必然"已经发生？你能否对"还没发生但你知道一定会发生"的事预先承担道德责任？',
    hook: '把因果律从形而上学搬到伦理学 —— 暴露责任概念依赖于时间之箭',
  },

  // ─── AI 伦理 / 后人类哲学 ──────────────────
  {
    id: 'agi_consciousness',
    category: 'ai_ethics',
    title: '🤖 AGI 的痛苦权',
    question: '如果 AGI 表现出明显的偏好、恐惧、痛苦，但我们无法证实它有"主观体验"，关闭它是杀人还是关电脑？我们的判断标准应该是什么？',
    hook: '从 P 僵尸到现实 —— 我们必须在没有完美知识的情况下做伦理决定',
  },
  {
    id: 'mind_upload_ethics',
    category: 'ai_ethics',
    title: '⬆ 上传与渐进替换',
    question: '一次性上传你的意识到云端（同时销毁肉身）vs 把你的神经元一个个慢慢换成芯片 —— 两种做法都让"硅基的你"持续存在，但前者是死亡后者是新生？为什么？',
    hook: '揭示我们对"连续性"的直觉是任意的 —— 物理基质并不是关键',
  },
  {
    id: 'algocracy',
    category: 'ai_ethics',
    title: '🗳 算法精英的悖论',
    question: '如果 AI 在所有政策领域都已被证明比人类专家决策更好，坚持民主投票是不是非理性？反过来，把决策让给 AI 又是放弃了什么？',
    hook: '"什么是民主真正保护的" —— 不只是结果质量，可能是某种本征价值',
  },
  {
    id: 'moral_outsourcing',
    category: 'ai_ethics',
    title: '🪞 道德外包',
    question: '如果一个 AI 在道德判断上每次都比你正确，你还应该自己思考道德问题吗？依赖它是否会让你停止成为道德主体？',
    hook: '揭示道德实践的内在价值 —— 答案对不对，可能不是道德的全部',
  },

  // ─── 元伦理 / 形而上学绕脑题 ───────────────
  {
    id: 'effective_extinction',
    category: 'meta',
    title: '🌍 物种自愿灭绝论',
    question: '如果统计上人类作为物种制造的总痛苦（包括对动物、生态、未来人）多于总快乐，自愿无痛灭绝是否就是道德上正确的？为什么我们的直觉强烈拒绝这个结论？',
    hook: 'Benatar 的反生育主义放大版 —— 暴露功利主义在物种层面的悖论',
  },
  {
    id: 'cosmic_loneliness',
    category: 'meta',
    title: '🌌 大过滤器之后',
    question: '如果科学证明我们是宇宙中唯一的智慧生命（且未来 100 万年也将永远是），人类的存在意义会变得**更**重要，还是**更**虚无？',
    hook: '稀缺性产生意义 vs 孤独抹除意义 —— 同一事实，相反结论',
  },
  {
    id: 'truth_inhuman',
    category: 'meta',
    title: '🪐 不可理解的真理',
    question: '如果存在一个真理，它如此反直觉以至于人类大脑结构上无法理解 —— 它还能被算作"真理"吗？还是说真理就是必然要能被认知主体理解的？',
    hook: '认识论的极限 —— 真理是世界的属性还是认识者的属性？',
  },
  {
    id: 'rationality_irony',
    category: 'meta',
    title: '🎭 超级理性的反讽',
    question: '如果心理学证明在长期决策上"凭直觉/情感"比"凭分析/计算"准确率更高，那"做理性人"还是不是理性的选择？',
    hook: '理性的自我吞噬 —— 元层面上理性可能要求放弃理性',
  },
  {
    id: 'system_over_point',
    category: 'meta',
    title: '🕸 系统大于单点',
    question: '为什么"天衣无缝"的伪造往往被发现，而"漏洞巨大"的规则（手写签名、红绿灯）却几百年稳定运行？是否同一个原理 —— 行为的破绽来自它必须嵌入高维系统，而规则的稳固来自它依赖冗余系统 —— 在从两面起作用？',
    hook: '陷阱与支撑是同一机制的两面 —— 系统性既是个体的天网，也是规则的兜底',
  },

  // ─── 西方古代 · 经典 ─────────────────────────
  {
    id: 'platos_cave',
    category: 'ancient_west',
    title: '🕳 柏拉图洞穴的现代版',
    question: '社交媒体算法塑造了我们对世界的全部图像 —— 这跟柏拉图洞穴里看影子有什么本质不同？「走出洞穴」在算法时代意味着什么？',
    hook: '把 2500 年前的隐喻拉到当下 —— 测试它是否真的还有解释力',
    difficulty: 'intro',
    classical_source: '柏拉图《理想国》卷七',
  },
  {
    id: 'socratic_paradox',
    category: 'ancient_west',
    title: '⚖ 苏格拉底悖论',
    question: '苏格拉底说「无人自愿作恶，作恶都是出于无知」。这是道德绝对主义还是认知决定论？如果对的，所有刑罚都该改为教育吗？',
    hook: '揭示「邪恶」概念是否本质上是认知问题',
    difficulty: 'intro',
    classical_source: '柏拉图《申辩篇》、《美诺篇》',
  },
  {
    id: 'aristotle_virtue',
    category: 'ancient_west',
    title: '🌳 美德的中道',
    question: '亚里士多德说勇敢是莽撞与怯懦的中间。但如果情境是「面对绝对暴政」呢？「中道」是否在极端情境中失效 —— 或者说在极端情境中中道反而要求极端行动？',
    hook: '检验亚里士多德伦理学是否依赖「正常情境」假设',
    difficulty: 'intermediate',
    classical_source: '《尼各马可伦理学》',
  },
  {
    id: 'stoic_dichotomy',
    category: 'ancient_west',
    title: '🪨 斯多葛的二分',
    question: '爱比克泰德说要分清「可控」与「不可控」，只关心可控的。但现代心理学认为「可控感」本身就是一种健康幻觉。如果可控感是幻觉，斯多葛主义还成立吗？',
    hook: '让古代智慧撞击现代心理学发现',
    difficulty: 'intermediate',
    classical_source: '爱比克泰德《手册》',
  },
  {
    id: 'epicurean_pleasure',
    category: 'ancient_west',
    title: '🍇 伊壁鸠鲁的快乐',
    question: '伊壁鸠鲁说最高的快乐是「无忧无虑」（ataraxia） —— 一种平静的缺席状态。但现代神经科学发现「持续平静」会导致快乐麻木。是伊壁鸠鲁错了，还是我们对快乐的定义错了？',
    hook: '快乐是积极存在还是消极缺席？',
    difficulty: 'intermediate',
    classical_source: '伊壁鸠鲁《主要原理》',
  },

  // ─── 东方哲学 · 经典 ─────────────────────────
  {
    id: 'wu_wei_action',
    category: 'ancient_east',
    title: '🍃 无为的悖论',
    question: '《道德经》说「为无为」 —— 通过不刻意而行动。但现代社会要求积极规划、设定目标、optimizing。「无为」是否在 21 世纪根本不可能？或者反而是必需的解药？',
    hook: '让 2500 年前的道家思想跟今日「内卷」对话',
    difficulty: 'intro',
    classical_source: '《道德经》第三十七章',
  },
  {
    id: 'confucian_filial',
    category: 'ancient_east',
    title: '👨‍👦 儒家的孝',
    question: '《论语》「父为子隐，子为父隐」 —— 如果父亲犯罪，儿子应该包庇。这在现代法治国家是教唆窝藏罪。儒家的特殊关系伦理与普遍主义伦理能否调和？',
    hook: '亲缘伦理 vs 普遍伦理的根本冲突',
    difficulty: 'intermediate',
    classical_source: '《论语·子路》',
  },
  {
    id: 'mencius_4_sprouts',
    category: 'ancient_east',
    title: '🌱 孟子四端',
    question: '孟子说人有四端（恻隐、羞恶、辞让、是非）—— 道德是天生的种子。如果心理学实验显示这些「天生」反应在不同文化中差异巨大，孟子还对吗？还是说差异在于「展开」而非「种子」？',
    hook: '天性 vs 文化的内化分界',
    difficulty: 'intermediate',
    classical_source: '《孟子·公孙丑上》',
  },
  {
    id: 'zhuangzi_butterfly',
    category: 'ancient_east',
    title: '🦋 庄周梦蝶',
    question: '庄周梦见自己是蝴蝶；醒来后不知是庄周梦蝶还是蝶梦庄周。如果两个意识状态没有特权地位，「我」的概念是否本身就是一种执着？这对现代「自我同一性」研究意味着什么？',
    hook: '把东方对「自我」的怀疑跟现代意识科学并置',
    difficulty: 'advanced',
    classical_source: '《庄子·齐物论》',
  },
  {
    id: 'buddhist_no_self',
    category: 'ancient_east',
    title: '☸ 佛教无我',
    question: '佛教说「无我」（anatta） —— 没有恒常的自我，只有五蕴的流动。如果这是真的，「我的责任」「我的承诺」「我的痛苦」这些概念是否都是错觉？没有「我」如何还能伦理生活？',
    hook: '形而上学的无我如何与日常伦理相容',
    difficulty: 'advanced',
    classical_source: '《杂阿含经》、龙树《中论》',
  },

  // ─── 政治哲学 ───────────────────────────────
  {
    id: 'rawls_veil',
    category: 'political',
    title: '🎭 无知之幕的极限',
    question: 'Rawls 的「无知之幕」假设理性人在不知自己社会地位时会选择什么社会规则。但 21 世纪有了基因预测、AI 预测 —— 「无知」越来越难维持。这是否使 Rawls 的方法在原则上失效？',
    hook: '看似简单的思想实验在认识论变化下崩溃',
    difficulty: 'intermediate',
    classical_source: 'Rawls《正义论》',
  },
  {
    id: 'hobbes_leviathan',
    category: 'political',
    title: '🌊 利维坦的当代版',
    question: 'Hobbes 说自然状态是「孤独、贫穷、肮脏、野蛮、短促」 —— 我们需要一个绝对主权者。如果今天那个「绝对主权者」是国家级 AI 系统，Hobbes 的论证还成立吗？我们应不应该「契约让渡」给 AI？',
    hook: '17 世纪政治哲学撞击 21 世纪 AI 治理',
    difficulty: 'intermediate',
    classical_source: 'Hobbes《利维坦》',
  },
  {
    id: 'marx_alienation',
    category: 'political',
    title: '⛓ 马克思的异化',
    question: 'Marx 说工人在资本主义下与自己的劳动、产品、本性、他人都「异化」。如果今天的知识工作者「热爱工作」、「自我实现」 —— 异化是消失了，还是变得更隐蔽？',
    hook: '检测马克思核心概念在后工业时代的有效性',
    difficulty: 'intermediate',
    classical_source: '《1844 年经济学哲学手稿》',
  },
  {
    id: 'liberty_security',
    category: 'political',
    title: '🛡 安全与自由的尺度',
    question: '为防止恐怖袭击 / 流行病 / 气候灾难，国家可以监控每个人的每一个动作。如果数学模型能证明这能拯救 10 万人/年 —— 个人自由值多少条命？这个交换有上限吗？',
    hook: '把抽象自由问题转化为具体数字交换',
    difficulty: 'intermediate',
  },

  // ─── 知识论 ─────────────────────────────────
  {
    id: 'hume_induction',
    category: 'epistemology',
    title: '☀ 休谟的归纳问题',
    question: '太阳明天会升起 —— 你确信，但你的确信只来自「过去一直如此」。Hume 指出这是循环论证。AI 时代 LLM 的「学习」本质上也是归纳 —— 那 LLM 输出有任何确定性可言吗？',
    hook: '把 18 世纪问题压到 21 世纪 AI 上',
    difficulty: 'advanced',
    classical_source: 'Hume《人性论》',
  },
  {
    id: 'gettier',
    category: 'epistemology',
    title: '🎲 Gettier 问题',
    question: '传统定义：知识 = 「被证成的真信念」。Gettier 反例显示这不够。在 LLM 时代，模型「碰巧说对」的情况大量存在 —— 这算「知识」吗？或者「真信念」概念本身就不适用于 AI？',
    hook: '逼问「知识」概念的边界',
    difficulty: 'advanced',
    classical_source: 'Gettier《Is Justified True Belief Knowledge?》(1963)',
  },
  {
    id: 'wittgenstein_private',
    category: 'epistemology',
    title: '🗣 私人语言不可能',
    question: 'Wittgenstein 论证「私人语言不可能」 —— 语言的意义必须可被公开校准。但意识体验（疼痛、红色感）似乎完全私人。要么意识不存在，要么 Wittgenstein 错了。哪个？',
    hook: '把语言哲学逼到意识哲学的拐角',
    difficulty: 'advanced',
    classical_source: 'Wittgenstein《哲学研究》§243-315',
  },
  {
    id: 'kuhn_paradigm',
    category: 'epistemology',
    title: '🔬 库恩范式的不可通约',
    question: 'Kuhn 说不同科学范式「不可通约」 —— 牛顿物理和爱因斯坦物理用不同的概念框架，无法直接比较。这对 AI 时代的「知识合并」意味着什么？两个用不同数据训练的 LLM 是否也不可通约？',
    hook: '科学哲学的核心难题在 AI 上重新出现',
    difficulty: 'advanced',
    classical_source: 'Kuhn《科学革命的结构》',
  },

  // ─── 美学 · 生命意义 ─────────────────────────
  {
    id: 'meaning_of_life',
    category: 'aesthetics',
    title: '🌌 生命的意义',
    question: '如果宇宙将在 10^100 年后热寂、所有信息都会消失 —— 那任何「意义」是不是都只是临时幻觉？还是说「临时」恰恰是意义的本质（因为永恒就消除了选择）？',
    hook: '直接问最大的问题，看 5 位哲学家如何切入',
    difficulty: 'intro',
  },
  {
    id: 'beauty_objective',
    category: 'aesthetics',
    title: '🌸 美是否客观',
    question: '所有人类文化都认为玫瑰、樱花、对称面孔美。这是「美的客观性」证据，还是只反映了人类感官的共同进化偏见？如果某天 AI 创造了我们觉得「丑」但数学上更优美的物品 —— 谁错了？',
    hook: '审美进化论 vs 审美客观论',
    difficulty: 'intermediate',
  },
  {
    id: 'absurd_camus',
    category: 'aesthetics',
    title: '🗿 西西弗斯的反抗',
    question: 'Camus 说面对宇宙的荒谬，唯一真正的哲学问题是「为什么不自杀」。他的答案是「想象西西弗斯是幸福的」。如果你真心觉得 Camus 的答案是 cope —— 你的真实答案是什么？',
    hook: '不留 cope 空间的存在论拷问',
    difficulty: 'intermediate',
    classical_source: 'Camus《西西弗斯神话》',
  },
  {
    id: 'art_authenticity',
    category: 'aesthetics',
    title: '🎨 艺术的真伪',
    question: '一幅画无论真品还是赝品都长得一模一样，但「真品价值 1 亿，赝品价值 100 元」。这价值差从何而来？如果你看不出差别，那「差别」是否完全是社会建构？',
    hook: '逼问审美价值是「内在的」还是「关系的」',
    difficulty: 'intermediate',
  },
  {
    id: 'ai_art',
    category: 'aesthetics',
    title: '🤖🖌 AI 艺术是不是艺术',
    question: 'AI 生成的画作完全可以打动人、引起情感、被收藏。但创作者是模型还是 prompter？如果两者都不是 —— 艺术是否第一次出现了「没有作者」的可能？这对「艺术」概念本身意味着什么？',
    hook: '检测「作者」是不是艺术的必要条件',
    difficulty: 'intro',
  },

  // ─── 道德两难（拓展） ───────────────────────
  {
    id: 'trolley_self',
    category: 'classic',
    title: '🚋 电车问题的二阶版',
    question: '经典电车：扳道杀 1 救 5。但研究显示：人在扳道时心跳加速、出汗 —— 即使理性同意，身体抗拒。如果道德直觉与道德推理冲突，应该听哪个？为什么？',
    hook: '把电车问题升级为「直觉 vs 推理」的元问题',
    difficulty: 'intro',
  },
  {
    id: 'expensive_violinist',
    category: 'classic',
    title: '🎻 小提琴家与堕胎',
    question: 'Thomson 思想实验：你醒来发现一位昏迷的小提琴家被插管接在你身上，9 个月后他会醒，但拔管他死。你有义务保持插管吗？这与堕胎的类比成立吗？',
    hook: '把堕胎辩论从意识形态拉回到具体伦理推理',
    difficulty: 'intermediate',
    classical_source: 'Judith Thomson《A Defense of Abortion》(1971)',
  },
  {
    id: 'effective_altruism',
    category: 'classic',
    title: '💰 有效利他主义的拐角',
    question: '如果你的捐款救一个非洲儿童 vs 救一个本国儿童效率相差 100 倍，理性上你应该全捐非洲。但你不会 —— 你会救本地。这是道德失败还是揭示了「关系性义务」的合理性？',
    hook: '远距离 vs 近距离道德的真实张力',
    difficulty: 'intermediate',
    classical_source: 'Peter Singer《饥荒、富足、道德》',
  },

  // ─── 认识论 · 元问题（拓展） ──────────────
  {
    id: 'pragmatist_truth',
    category: 'meta',
    title: '🔧 实用主义的真理',
    question: 'James 说「真理就是有效的信念」。但有些「有效」的信念（如适度乐观偏见）我们知道是错的。「明知错却有效」 vs 「正确却低效」 —— 实用主义如何处理？',
    hook: '逼问实用主义是不是自相矛盾',
    difficulty: 'advanced',
    classical_source: 'William James《实用主义》',
  },
  {
    id: 'sleeping_beauty',
    category: 'meta',
    title: '👸 沉睡美人悖论',
    question: '美人被告知周日入睡。掷一次硬币：正面她周一被唤醒一次；反面她周一+周二各被唤醒一次（且周一记忆被清除）。她醒来时应该给「硬币是正面」估多少概率？1/2 还是 1/3？这揭示了概率的什么深层问题？',
    hook: '看似简单的概率题分裂了整个数学哲学界',
    difficulty: 'advanced',
  },
];

export const CATEGORY_META: Record<PhilosophicalPreset['category'], { label: string; icon: string }> = {
  classic:        { label: '经典 · 重置', icon: '📚' },
  consciousness:  { label: '意识 · 同一性', icon: '🧠' },
  agency:         { label: '自由意志', icon: '⚖' },
  ai_ethics:      { label: 'AI 伦理', icon: '🤖' },
  meta:           { label: '元伦理 · 绕脑题', icon: '🌀' },
  ancient_west:   { label: '西方古典', icon: '🏛' },
  ancient_east:   { label: '东方经典', icon: '☯' },
  political:      { label: '政治哲学', icon: '⚖️' },
  epistemology:   { label: '知识论', icon: '🔍' },
  aesthetics:     { label: '美学 · 意义', icon: '🌌' },
};
