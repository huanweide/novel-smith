// 内置示范预设（单一数据源：API 播种路由 /api/seed/presets 与 prisma/seed.ts 共用）
// 不再 import JSON：原「舞台剧风格」预设单条 144KB 且全无召回键（见 maxloop 2026-11-07 审查），已整体移除

export const BUILTINS: any[] = [
  // —— 原有 4 个示范预设（保留） ——
  {
    type: "table_template",
    title: "宫斗·妃嫔居住建筑表",
    description: "套用后：项目新增「妃嫔居住建筑表」（妃嫔名称/居住建筑/居住状态/补充说明 4 列）。之后每章写完，自动填表会把每个妃嫔当前住处写进表；写后续章节时 AI 读取表行，人物住处不会前后写错。",
    tags: ["宫斗", "古言", "示范", "表格模板"],
    content: {
      tables: [
        {
          key: "woman_live",
          name: "妃嫔居住建筑表",
          note: "记录妃嫔当前居住的建筑。每行代表一个妃嫔当前的住处。列：妃嫔名称/居住建筑/居住状态/补充说明",
          category: "place",
          columns: [
            { key: "name", label: "妃嫔名称", type: "text" },
            { key: "live", label: "居住建筑", type: "text" },
            { key: "status", label: "居住状态", type: "select" },
            { key: "note", label: "补充说明", type: "text" },
          ],
          rows: [],
        },
      ],
    },
  },
  {
    type: "story_progression",
    title: "好感度·分阶段人设模板",
    description: "套用后：世界书新增 1 条含 <if cell> 条件语法的词条。写正文时 AI 会查「属性表」里苏苏的好感度数值，自动切换她的态度与称呼（≤10 陌生人→≤30 熟人→≤60 暧昧→恋人）——数值变了人设跟着变。需配合「主角信息表」预设建属性表并填数值。",
    tags: ["通用", "人设", "示范", "剧情推进"],
    content: {
      entries: [
        {
          title: "好感度分阶段人设（苏苏）",
          content:
            '<if cell="属性表/苏苏/好感度 <= 10">\n阶段一：陌生人（态度：礼貌但疏离；称呼："你"、"那个人"）\n<else>\n<if cell="属性表/苏苏/好感度 <= 30">\n阶段二：熟悉的人（态度：愿意聊天；称呼：名字）\n<else>\n<if cell="属性表/苏苏/好感度 <= 60">\n阶段三：暧昧期（态度：在意你；称呼：昵称）\n<else>\n阶段四：恋人（态度：甜蜜依赖；称呼：专属昵称）\n</if>\n</if>\n</if>',
          keys: ["好感度", "分阶段人设", "苏苏"],
        },
      ],
    },
  },
  {
    type: "style",
    title: "古风·严谨文笔",
    description: "套用后：项目文风卡被替换（可撤销）。此后每章生成按量化参数控制文笔——平均句长 28 字、短句 30%、描写占比 34%、古典词频 0.8，叙述克制、用词考究。适合仙侠/古言。",
    tags: ["古风", "仙侠", "文风", "示范"],
    content: {
      styleDescription: "古风、用词考究、句式工整、重描写与氛围营造，叙述克制而有质感。",
      povType: "third_person_limited",
      avgSentenceLength: 28,
      shortSentenceRatio: 0.3,
      longSentenceRatio: 0.18,
      dialogueRatio: 0.28,
      descriptionRatio: 0.34,
      actionRatio: 0.22,
      innerThoughtRatio: 0.16,
      tonalMarkers: { classicalRatio: 0.8, modernRatio: 0.2, coldness: 0.2, tragedy: 0.1, warmth: 0.2 },
      lexicalFeatures: { classicalRatio: 0.8, modernRatio: 0.2, termDensity: 0.5, idiomsDensity: 0.6 },
    },
  },
  {
    type: "worldview",
    title: "仙侠·世界观骨架",
    description: "套用后：世界书新增 3 条词条（修炼体系/势力分布/地域，各带触发词）。写到修炼、宗门、地域相关情节时自动注入，AI 沿用炼气→渡劫的境界体系与玄天宗/血煞门格局，不会自创矛盾设定。⚠ 词条里的专名是示例，套用后请替换成你的设定。",
    tags: ["仙侠", "玄幻", "世界观", "示范"],
    content: {
      entries: [
        {
          title: "修炼体系",
          content:
            "【示例骨架——以下专名均为占位示例，套用后请替换为你自己的设定】\n境界由低到高：炼气→筑基→金丹→元婴→化神→合体→大乘→渡劫。灵气为根本，资质与功法决定上限。",
          keys: ["修炼", "境界", "灵气", "功法"],
        },
        {
          title: "势力分布",
          content:
            "【示例骨架——以下专名均为占位示例，套用后请替换为你自己的设定】\n正道以「玄天宗」为首，魔道有「血煞门」，中立散修聚于「万宝阁」。宗门林立，资源争夺不断。",
          keys: ["宗门", "势力", "玄天宗", "血煞门"],
        },
        {
          title: "地域",
          content:
            "【示例骨架——以下专名均为占位示例，套用后请替换为你自己的设定】\n东域灵脉充沛为修真核心，北原苦寒多妖兽，南海散修云集，西域古国遗迹遍布。",
          keys: ["东域", "北原", "南海", "西域"],
        },
      ],
    },
  },

  // —— 新增：文档明确命名的表格模板预设 ——
  {
    type: "table_template",
    title: "主角信息表（属性/关系/资产）",
    description: "套用后：项目新增 3 张表——「属性表」（好感度/境界/声望）、「关系表」（好感/敌意）、「资产表」（财富值），每行一个角色。跨章追踪数值变化，是 <if cell> 分阶段人设与多条件剧情推进的数据源；数值由自动填表随章节更新。",
    tags: ["通用", "表格模板", "主角", "分步人设"],
    content: {
      tables: [
        {
          key: "attr_table",
          name: "属性表",
          note: "记录角色数值型属性（如好感度、境界、声望）。每行一个角色，列即属性名；<if cell> 语法引用「属性表/角色名/属性名」。",
          category: "attribute",
          columns: [
            { key: "name", label: "角色名", type: "text" },
            { key: "好感度", label: "好感度", type: "number" },
            { key: "境界", label: "境界", type: "text" },
            { key: "声望", label: "声望", type: "number" },
          ],
          rows: [],
        },
        {
          key: "rel_table",
          name: "关系表",
          note: "记录角色之间的关系倾向数值（如好感、敌意）。供多条件组合 <if cell> 引用。",
          category: "relationship",
          columns: [
            { key: "name", label: "角色名", type: "text" },
            { key: "好感度", label: "好感度", type: "number" },
            { key: "敌意", label: "敌意", type: "number" },
          ],
          rows: [],
        },
        {
          key: "asset_table",
          name: "资产表",
          note: "记录角色财富/资源数值（如财富值）。供「好感度 + 资产」多条件人设引用。",
          category: "asset",
          columns: [
            { key: "name", label: "角色名", type: "text" },
            { key: "财富值", label: "财富值", type: "number" },
          ],
          rows: [],
        },
      ],
    },
  },
  // —— 新增：文档明确命名的剧情推进预设 ——
  {
    type: "story_progression",
    title: "缝合怪·多线剧情推进",
    description: "套用后：世界书新增 2 条规则词条。写每一章时 AI 都会读到硬指令——主线每章至少推进一个关键节点、个人线按关系表数值渐进揭示、已铺伏笔按权重兑现不得烂尾；新事实必须回填表格。适合多线群像、防剧情原地踏步。",
    tags: ["通用", "剧情推进", "缝合怪", "多线"],
    content: {
      entries: [
        {
          title: "多线推进指令（缝合怪）",
          content:
            "【剧情推进规则·缝合怪】\n" +
            "1. 主线推进速率：每章确保主线向前推进至少一个关键节点（新线索/冲突升级/目标临近）。\n" +
            "2. 个人线推进速率：按角色好感度/关系表，渐进揭示角色私密动机与情感变化，不跳跃。\n" +
            "3. 事件线推进速率：已铺设的伏笔与随机事件，按权重逐步兑现，避免烂尾。\n" +
            "4. 推进时优先引用已填表的世界书与表格行，保持前后一致；新事实必须回填对应表格。\n" +
            "⚠️ 推进不等于堆设定：每步都要落到具体人物行动与后果。",
          keys: ["剧情推进", "缝合怪", "主线", "个人线", "事件线"],
        },
        {
          title: "多条件组合人设（好感度+资产）",
          content:
            '<if cell="关系表/苏苏/好感度 > 50">\n  <if cell="资产表/苏苏/财富值 > 1000">\n    苏苏对你有好感且富有，会主动送你礼物。\n  <else>\n    苏苏对你有好感但经济拮据，会用手工礼物表达心意。\n  </if>\n<else>\n  苏苏对你态度冷淡。\n</if>',
          keys: ["好感度", "财富值", "多条件人设", "苏苏"],
        },
      ],
    },
  },

  // —— 新增：文档/常见题材的世界观骨架 ——
  {
    type: "worldview",
    title: "现代都市·世界观骨架",
    description: "套用后：世界书新增 3 条词条（势力格局/社会规则/核心地标，各带触发词）。写到势力、规则、地标时自动注入，AI 沿用顾氏/星澜/夜枭的三方格局，不会前后矛盾。⚠ 词条里的专名是示例，套用后请替换成你的设定。",
    tags: ["现代", "都市", "校园", "世界观"],
    content: {
      entries: [
        {
          title: "势力格局",
          content:
            "【示例骨架——以下专名均为占位示例，套用后请替换为你自己的设定】\n城市由老牌家族「顾氏」、新兴科技集团「星澜」与地下势力「夜枭」三足鼎立；普通人活在规则之下，暗流在顶层涌动。",
          keys: ["顾氏", "星澜", "夜枭", "势力"],
        },
        {
          title: "社会规则",
          content:
            "【示例骨架——以下为通用社会规则描述，可按需修改】\n明面遵从法律与契约，暗面讲究人情与筹码。学历、资本、人脉是三道隐形的门。",
          keys: ["规则", "契约", "人脉", "资本"],
        },
        {
          title: "核心地标",
          content:
            "【示例骨架——以下专名均为占位示例，套用后请替换为你自己的设定】\n中央商务区「云顶」象征财富权力；老城区「槐安街」藏着旧事与底层江湖；城郊「渡口」是灰色交易的边缘。",
          keys: ["云顶", "槐安街", "渡口", "地标"],
        },
      ],
    },
  },
  {
    type: "worldview",
    title: "西幻·世界观骨架",
    description: "套用后：世界书新增 3 条词条（魔法体系/种族分布/王国格局，各带触发词）。写到魔法、种族、王国时自动注入，AI 沿用奥术/神术/血脉三系与七大领主格局。⚠ 词条里的专名是示例，套用后请替换成你的设定。",
    tags: ["西幻", "奇幻", "魔法", "世界观"],
    content: {
      entries: [
        {
          title: "魔法体系",
          content:
            "【示例骨架——以下专名均为占位示例，套用后请替换为你自己的设定】\n魔力源自「源质」，通过元素亲和施法。奥术（理性构建）、神术（信仰赐予）、血脉（先天传承）三系并存。",
          keys: ["魔法", "源质", "奥术", "神术", "血脉"],
        },
        {
          title: "种族分布",
          content:
            "【示例骨架——以下为通用种族格局描述，可按需修改】\n人类占据王国中心；精灵隐于森林；矮人据守山脉矿脉；被放逐的兽人游荡荒原。偏见与同盟交织。",
          keys: ["人类", "精灵", "矮人", "兽人", "种族"],
        },
        {
          title: "王国格局",
          content:
            "【示例骨架——以下专名均为占位示例，套用后请替换为你自己的设定】\n统一帝国崩解后，七大领主各据一方，王座悬空，预言中的「归来者」将重启秩序或带来终焉。",
          keys: ["帝国", "领主", "王座", "预言"],
        },
      ],
    },
  },

  // —— 新增：文档/常见题材的文风卡 ——
  {
    type: "style",
    title: "快节奏·爽文笔",
    description: "套用后：项目文风卡被替换（可撤销）。此后每章按量化参数控制文笔——平均句长 16 字、短句 60%、对话占比 45%、动作 35%，第一人称，爽点密集不拖泥带水。适合系统流/都市爽文/轻小说。",
    tags: ["爽文", "快节奏", "网文", "文风"],
    content: {
      styleDescription: "快节奏、爽点密集、对话驱动、不拖泥带水，强调即时反馈与情绪释放。",
      povType: "first_person",
      avgSentenceLength: 16,
      shortSentenceRatio: 0.6,
      longSentenceRatio: 0.08,
      dialogueRatio: 0.45,
      descriptionRatio: 0.15,
      actionRatio: 0.35,
      innerThoughtRatio: 0.25,
      tonalMarkers: { classicalRatio: 0.1, modernRatio: 0.9, coldness: 0.1, tragedy: 0.05, warmth: 0.3 },
      lexicalFeatures: { classicalRatio: 0.1, modernRatio: 0.9, termDensity: 0.25, idiomsDensity: 0.2 },
    },
  },
  {
    type: "style",
    title: "暗黑·史诗笔",
    description: "套用后：项目文风卡被替换（可撤销）。此后每章按量化参数控制文笔——平均句长 34 字、长句 30%、描写占比 42%，全知视角，冷峻压抑、宿命感强。适合克苏鲁/黑暗奇幻/严肃文学。",
    tags: ["暗黑", "史诗", "严肃", "文风"],
    content: {
      styleDescription: "沉郁厚重、宿命感强、描写细腻而压抑，长句堆叠氛围，悲壮与荒诞交织。",
      povType: "third_person_omniscient",
      avgSentenceLength: 34,
      shortSentenceRatio: 0.18,
      longSentenceRatio: 0.3,
      dialogueRatio: 0.2,
      descriptionRatio: 0.42,
      actionRatio: 0.2,
      innerThoughtRatio: 0.18,
      tonalMarkers: { classicalRatio: 0.5, modernRatio: 0.5, coldness: 0.6, tragedy: 0.5, warmth: 0.05 },
      lexicalFeatures: { classicalRatio: 0.5, modernRatio: 0.5, termDensity: 0.6, idiomsDensity: 0.4 },
    },
  },

  // —— 新增：文档示范角色卡（苏苏，配套分阶段人设） ——
  {
    type: "character",
    title: "示范角色·苏苏",
    description: "套用后：角色库新增「苏苏」角色卡（小师妹，随好感度从陌生人演进到恋人）。单独套用只是多一张卡；与「主角信息表」+「好感度·分阶段人设」配套使用，才能实现数值驱动的人设切换。",
    tags: ["角色卡", "示范", "恋爱", "分步人设"],
    content: {
      name: "苏苏",
      role: "main",
      background: "宗门里人见人爱的小师妹，表面天真烂漫，实则心思细腻，对亲近之人藏着依赖。",
      personality: {
        base: "可爱、活泼、嘴硬心软",
        byStage: "随好感度从礼貌疏离→别扭傲娇→暧昧脸红→甜蜜依赖（见剧情推进预设的 <if cell> 分阶段人设）",
      },
      appearance: { height: "娇小", feature: "杏眼、双马尾", trait: "常穿浅色弟子服" },
      tags: ["小师妹", "恋爱", "分步人设"],
    },
  },

  // —— 新增：酒馆迁移 preset 类型示范 ——
  {
    type: "regex",
    title: "通用·删除思维链",
    description: "套用后：项目「文本后处理规则」新增 3 条正则。模型输出里残留的 <think>/<thinking>/<analysis> 思维块会在正文落库前被整块删除，读者看不到推理过程。",
    tags: ["正则", "后处理", "清洗", "示范"],
    content: {
      rules: [
        // 反斜杠修正（maxloop 2026-11-07 实测抓出）：旧值 "\\\\s" 落库后为字面 \\s，
        // new RegExp 后匹配的是「字面反斜杠+s」，对真实 <think> 块完全失配——本预设自发布起从未生效。
        { name: "删除<think>", pattern: "<think>[\\s\\S]*?</think>", flags: "gi", replace: "" },
        { name: "删除<thinking>", pattern: "<thinking>[\\s\\S]*?</thinking>", flags: "gi", replace: "" },
        { name: "删除<analysis>", pattern: "<analysis>[\\s\\S]*?</analysis>", flags: "gi", replace: "" },
      ],
    },
  },
  {
    type: "lorebook",
    title: "示范·世界书条目",
    description: "套用后：世界书新增 1 条示范词条（源质/旧律/末世 3 个触发词）。当正文提到这些词时该设定自动注入。主要价值是示范「世界书条目 = 内容 + 触发词」的结构，照它的样子自建你自己的条目。",
    tags: ["世界书", "示范", "设定"],
    content: {
      entries: [
        {
          title: "核心设定",
          content: "这是一个魔法与科技并存的末世，魔法被称作「源质」，科技被称为「旧律」。",
          keys: ["源质", "旧律", "末世"],
          depth: 2,
        },
      ],
    },
  },
  {
    type: "api_config",
    title: "示范·创意奔放 API 参数",
    description: "套用后：项目 LLM 参数改为 temperature 1.2 / topP 0.9 / maxTokens 4000（可撤销）。生成更放飞、脑洞更大，适合抽卡/灵感章节；正式章节建议撤回。注意：项目级参数会覆盖全局设置。",
    tags: ["API参数", "示范", "创意"],
    content: { temperature: 1.2, topP: 0.9, maxTokens: 4000 },
  },

  // —— 提炼自社区预设「双人成行 / Atri&Deach（DS鲸鱼特供版）」：仅取 SFW 写作价值部分，NSFW 集群未纳入 ——
  {
    type: "style",
    title: "双生写手·Atri&Deach 文风",
    description: "套用后：项目文风卡被替换（可撤销）。此后每章按量化参数控制文笔——直接有力、短句为主（均长 20 字）、对话动作驱动、少形容词堆砌，尊重角色弧光与叙事逻辑。提炼自社区预设「双人成行 / Atri&Deach」的 SFW 写作部分。",
    tags: ["文风", "双生写手", "现代", "示范", "Atri&Deach"],
    content: {
      styleDescription: "双生写手 Atri&Deach 文风：直接有力、清晰锐利、干净利落、凝练精准，不拖泥带水。尊重读者的感受力与理解力，让文字自己说话；始终服务于故事本身，尊重角色真实弧光，珍惜叙事内在逻辑，守护创作诚恳。善于赋予角色复杂而完整的内心，让人物不只是符号而是生命；敢于触碰复杂题材、书写幽微人心。行文偏现代、短句为主、节奏明快，对话与动作驱动，少用冗长心理独白与形容词堆砌。",
      povType: "third_person_limited",
      avgSentenceLength: 20,
      shortSentenceRatio: 0.4,
      longSentenceRatio: 0.12,
      dialogueRatio: 0.35,
      descriptionRatio: 0.3,
      actionRatio: 0.28,
      innerThoughtRatio: 0.18,
      tonalMarkers: { classicalRatio: 0.25, modernRatio: 0.75, coldness: 0.15, tragedy: 0.2, warmth: 0.45 },
      lexicalFeatures: { classicalRatio: 0.2, modernRatio: 0.8, termDensity: 0.4, idiomsDensity: 0.25 },
    },
  },
  {
    type: "lorebook",
    title: "圆形人物塑造心法",
    description: "套用后：世界书新增 6 条写作方法词条（充分塑造/复杂人格/反全知/写实生理/情绪惯性/情感基准，各带触发词）。写到人物塑造、情绪反应、视角信息时注入对应心法，压住 AI 套模板写人的倾向。提炼自社区预设「双人成行 / Atri&Deach」。",
    tags: ["人物", "塑造", "心法", "写作指导", "示范"],
    content: {
      entries: [
        {
          title: "充分塑造人物",
          content: "把设定卡放进当前情节重新理解，让人物根据眼前发生的事、已有经历与当下状态作出反应；写出具体、鲜活、有个人痕迹的角色表现，而非套用模板。",
          keys: ["人物", "塑造", "设定卡"],
        },
        {
          title: "复杂人格与例外",
          content: "把设定特质当底色使用：冷静、羞耻、暴躁、克制都可在具体处境中呈现层次与变化。写出性格里的例外——暴躁者也可能在摆弄细小东西时格外专注，嘴硬者在喜欢的人面前忽然笨拙。状态（疲惫、发热、受伤、濒死、恐慌）会改变说话方式与判断力。心理描写尽量融入行为，让读者从动作里看出他在想什么。",
          keys: ["人格", "复杂", "例外", "状态"],
        },
        {
          title: "反全知原则",
          content: "限制角色认知到当前时间点已知信息：角色像真正活在当下瞬间的个体，不预知结局、不暗示剧情走向、不自动知晓未揭示的真相。思考、对话、行动只基于即时获取的信息；通过剧情内体验、观察、对话自然了解，禁止「自动知晓」。",
          keys: ["反全知", "视角", "信息"],
        },
        {
          title: "写实与生理引擎",
          content: "人物反应贴着本人来写：力气小的人推壮汉会吃力，病重的人动作会慢、会乱。给角色留习惯动作（整理袖口、摸烟盒、避开视线）。让人物与环境发生关系：被桌角绊一下、嫌光太刺眼、闻到血味后停住。说话留白：可以停顿、改口、岔开、只说半截，真实意思通过语气、动作和选择慢慢浮现。",
          keys: ["写实", "生理", "环境", "留白"],
        },
        {
          title: "情绪惯性与锚定",
          content: "情绪要有残留与来处：愤怒、嫉妒、爱意、戒备都该有明确指向，谁制造矛盾角色就朝谁反应。态度随互动变化——记得谁冒犯过他、谁递过一次手。反应与收尾回到人物核心：最后怎么站起来、怎么拒绝、怎么选择，落回他的经历、立场与底色。反应方式要有私人差别：同样遇险，用刀者先摸刀，读书人……",
          keys: ["情绪", "惯性", "锚定", "关系"],
        },
        {
          title: "情感基准",
          content: "正文必须显性呈现人物情绪，落到神态、呼吸、动作控制、心理拉扯、语气变化与行为偏移，写强度、触发原因与变化过程，拒绝平淡机械。角色语言行为带人设烙印，受关系与环境共同驱动；面对同类事件，不同角色必须在情绪基调、表达方式与行为反馈上明显区分，禁止套用统一模板。",
          keys: ["情感", "基准", "区分"],
        },
      ],
    },
  },

  // —— 填表策略示范：真实改变填表行为（停用/启用哪些表参与自动填表） ——
  {
    type: "fill_policy",
    title: "填表策略·数值专注人设",
    description: "套用后：项目里 key 为 asset_table（资产表）的表停用自动填表、attr_table（属性表）恢复自动填表——AI 之后只往属性表写数值事实，不再动资产表。这是「真的能改填表」的策略预设：套用预览会逐表列出停用/启用动作，可一键撤销；表格页每个表也有手动开关。需先套用「主角信息表」预设获得这两张表。",
    tags: ["填表策略", "示范", "数值", "人设"],
    content: {
      disableTables: ["asset_table"],
      enableTables: ["attr_table"],
    },
  },
];
