/**
 * 20 个精选反直觉哲学议题，分 5 类。
 * 每个 preset 故意带「钩子」 —— 让 5 位 persona 的思维传统会真正撕扯起来，
 * 而不是各自给一段教科书答案。
 */

export interface PhilosophicalPreset {
  id: string;
  title: string;
  question: string;
  category: 'classic' | 'consciousness' | 'agency' | 'ai_ethics' | 'meta';
  hook: string;       // 为什么这个题反直觉 —— 一句钩子描述
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
];

export const CATEGORY_META: Record<PhilosophicalPreset['category'], { label: string; icon: string }> = {
  classic:        { label: '经典 · 重置', icon: '📚' },
  consciousness:  { label: '意识 · 同一性', icon: '🧠' },
  agency:         { label: '自由意志', icon: '⚖' },
  ai_ethics:      { label: 'AI 伦理', icon: '🤖' },
  meta:           { label: '元伦理 · 绕脑题', icon: '🌀' },
};
