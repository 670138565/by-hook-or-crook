/* =====================================================================
 * 全局配置文件（config.js）
 * =====================================================================
 * 作用：把游戏里那些"固定不变的数值"集中放在这里，方便统一修改。
 * 通俗讲：就像游戏的"控制面板"，你想改画布大小、移动速度、颜色，
 *        不用到各个文件里翻，直接来这里改一个地方就行。
 *
 * 我们用 window.CONFIG 把它挂到全局，这样所有文件都能用 CONFIG.xxx 访问。
 * ===================================================================== */
window.CONFIG = {
    // ---- 画布设置 ----
    GAME_WIDTH: 1280,        // 游戏画面宽度（像素）
    GAME_HEIGHT: 720,       // 游戏画面高度（像素）
    BG_COLOR: '#000000',    // 地图外背景（黑色）
    // 小地图：整张图在窗口里占多大（1=铺满，0.7=四周留黑边）。镜头不再按这个拉近。
    MAP_VIEW_FILL: 0.7,
    // 默认体型（PLAYER_SCALE）时的镜头倍率。亨利在屏幕上的大小 = 这个值，进房间也不拉近。
    CAMERA_MIN_ZOOM: 1.25,
    // 旧逻辑曾用这个限制小房间放大，现已不用（亨利大小锁死）
    CAMERA_MAX_ZOOM: 2.5,
    // 世界物体按「脚底 Y」排前后。深度和世界 Y 一比一，大地图也不会挤扁。
    // 建筑在遮挡线处拆开：线上挡人，线下贴地。滚轮 z 只微调同排前后，不能盖过脚底。
    // 深度带：地面 GROUND_DEPTH，贴地 FOOTPRINT，物体 BASE+世界Y，UI 50000+
    Y_SORT_BASE: 1000,
    Z_SORT_TIE: 0.01,
    // 地面必须低于所有建筑/摆件。滚轮把物体往后（z 为负）时深度大约是 z*1000，
    // 若地面停在 -8，往后一格就会钻到草地下面。
    GROUND_DEPTH: -1000000,
    FOOTPRINT_DEPTH: 8,
    // 亨利周围防遮挡圈：挡住他的建筑/摆件在圈里变淡（0.6=透出 40%）
    OCCLUSION_FADE_RADIUS: 100, // 按默认亨利（scale 0.5）的世界像素；地图里亨利更大则按比例放大
    OCCLUSION_FADE_ALPHA: 0.5,

    // ---- 玩家设置 ----
    START_GOLD: 0,           // 开局格罗申（钱，不进背包）
    START_LOCKPICKS: 3,      // 开局开锁器（资源，不进背包；开锁失败 -1）
    START_SKILL_POINTS: 3,   // 开局技能点（开背包左侧加点）
    LOCKPICK_REGEN_MS: 120000, // 走图时每 2 分钟自动 +1 开锁器
    WANTED_MAX: 3,            // 通缉上限。伏法清通缉并罚款+DEBUFF，逃跑仍加通缉
    MAX_HP: 30,              // 开局生命上限，升级再涨
    START_HP: 30,            // 开局生命，和走路、战斗共用
    // 可加点属性（永久基础；装备另算临时加成）
    ATTRS: [
        { key: '开锁', tip: '开锁：滑块变慢、绿区变宽' },
        { key: '潜行', tip: '潜行：更难被听见、被盯上' },
        { key: '口才', tip: '口才：被盘问、砍价更好说话' },
        { key: '销赃', tip: '销赃：卖赃物更贵（每点约 +5%）' }
    ],
    ATTR_FENCE_PCT: 5,       // 销赃每点：卖价 +5%
    LEVEL: {
        HP: 5,               // 每级生命上限 +5，当前生命也 +5
        EXPAND: 2,           // 每级给 2 个背包扩展点（约 15 级可铺满）
        XP_BASE: 8,          // 1→2 需要这么多经验
        XP_STEP: 1,          // 之后每级只多 1（约 225 经验到满包）
        QUEST_XP_BASE: 20,   // 交任务默认经验
        QUEST_XP_PER_GOAL: 6,
        SEARCH_XP: [0, 4, 6, 9, 12, 16], // 搜箱子按品质 1～5
        SKILL_POINT_PER_LEVEL: 1
    },
    TIME: {
        DAY_MS: 12 * 60 * 1000,     // 一天 12 分钟
        DAYLIGHT_MS: 8 * 60 * 1000, // 前 8 分钟白天，后 4 分钟夜里
        FOOD_WAIT_MS: 2 * 60 * 1000, // 地上食物这么久没人捡，NPC 看见会拿走
        NIGHT_HIDE: 0.55,           // 夜里没火把：被人看见/听见的距离 × 这个
        NIGHT_TORCH: 1.25,          // 夜里举火把：更容易被发现
        FOOD_SEE: 240,              // NPC 看见地上食物的距离
        DUSK_MS: 45 * 1000          // 天黑前这么久开始渐暗，能看见在变夜
    },
    CHEST_REFRESH_SECONDS: 300, // 可刷新箱子：开锁成功后多少秒重新上锁并重抽（想试刷新可改小，比如 20）
    PLAYER_SPEED: 200,       // 玩家移动速度（像素/秒），越大走得越快
    PLAYER_RUN_MULTIPLIER: 1.5, // 按住 Shift 跑步：速度乘这个数（1.5=快一半）
    PLAYER_SIZE: 32,         // 玩家碰撞体大小（像素）
    PLAYER_SCALE: 0.5,       // 玩家显示缩放（素材每帧256x256，缩到0.5=128x128，俯视角合适）
    PLAYER_FRAME: 256,       // 玩家素材单帧尺寸（像素），用于切图
    BOX_SCALE: 0.04,         // 木箱显示缩放（素材2048x2048，缩到0.04≈82x82，比亨利略小）
    BACKPACK_SCALE: 0.05,    // 背包显示缩放（素材1952x2272，缩到0.05≈98x114）

    // ---- 物理引擎设置 ----
    // Phaser 用 Arcade（街机）物理，简单轻量，适合俯视角游戏
    // 注意结构：必须先指定 default: 'arcade'，再把参数放进 arcade 子对象里
    // （之前写错了结构，导致物理引擎没启用，this.physics 是 undefined）
    PHYSICS: {
        default: 'arcade',         // 默认使用 arcade 物理引擎
        arcade: {
            gravity: { y: 0 },     // 重力设为0：俯视角游戏没有"往下掉"的概念
            debug: false           // 是否显示碰撞框（调试时改成true能看到碰撞线）
        }
    },

    // ---- 场景名称（用常量代替字符串，防止拼写错误）----
    // 通俗讲：给每个场景起个"代号"，后面切换场景时用代号，不容易写错
    SCENES: {
        BOOT: 'BootScene',       // 启动场景
        TITLE: 'TitleScene',     // 标题页
        PRELOAD: 'PreloadScene', // 资源加载场景
        GAME: 'GameScene',       // 主游戏场景
        STEAL: 'StealScene',     // 偷窃小游戏场景（叠在主游戏上的弹窗）
        BACKPACK: 'BackpackScene', // 背包界面场景（按Tab打开）
        SHOP: 'ShopScene',        // 商店：左背包，右上交易，右下货架
        DIALOGUE: 'DialogueScene', // 对话：走近 NPC 按 E
        BATTLE: 'BattleScene'      // 战斗：对话节点触发，叠在对话上
    },

    // ---- 战斗（背包即战场，生命和走路共用）----
    BATTLE: {
        ENERGY: 3,
        ENEMIES: {
            dog: {
                id: 'dog', name: '狗', hp: 25, shield: 0, gold: 4, xp: 4, lootTable: 'battle_dog',
                behaviors: [{ type: 'attack', value: 4, w: 100 }]
            },
            guard: {
                id: 'guard', name: '守卫', hp: 35, shield: 4, gold: 10, xp: 8, lootTable: 'battle_guard',
                behaviors: [
                    { type: 'attack', value: 8, w: 70 },
                    { type: 'block', value: 3, w: 30 }
                ]
            },
            bandit: {
                id: 'bandit', name: '强盗', hp: 45, shield: 5, gold: 16, xp: 12, lootTable: 'battle_bandit',
                behaviors: [
                    { type: 'attack', value: 10, w: 45 },
                    { type: 'heal', value: 4, w: 20 },
                    { type: 'attack', value: 7, w: 20, extra: { type: 'poison', value: 2 } },
                    { type: 'attack', value: 7, w: 15, extra: { type: 'block', value: 2 } }
                ]
            },
            captain: {
                id: 'captain', name: '队长', hp: 55, shield: 6, gold: 22, xp: 18, lootTable: 'battle_captain',
                behaviors: [
                    { type: 'attack', value: 11, w: 40 },
                    { type: 'heal', value: 6, w: 25 },
                    { type: 'attack', value: 8, w: 20, extra: { type: 'stun', chance: 40 } },
                    { type: 'attack', value: 8, w: 15, extra: { type: 'heal', value: 3 } }
                ]
            },
            elite: {
                id: 'elite', name: '精英守卫', hp: 55, shield: 9, gold: 28, xp: 24, thornsOnBreak: 3, lootTable: 'battle_elite',
                behaviors: [
                    { type: 'attack', value: 13, w: 40 },
                    { type: 'block', value: 6, w: 30 },
                    { type: 'attack', value: 9, w: 20, extra: { type: 'burn', value: 2 } },
                    { type: 'attack', value: 9, w: 10, extra: { type: 'block', value: 3 } }
                ]
            }
        }
    },

    // ---- 商店（收购比例、老板本金、刷新、砍价幅度都可以改）----
    SHOP: {
        BUY_RATE: 0.5,           // 收购价 = 图鉴价值 × 这个数（销赃默认一半）
        SELL_RATE: 1,            // 货架售价 = 图鉴价值 × 这个数
        BARGAIN_RANGE: 0.1,      // 砍价滑块两侧最大偏移（0.1=10%）。口才会再拉开
        DEFAULT_MONEY: 80,       // 老板默认带多少格罗申
        REFRESH_SECONDS: 300,    // 货架和本金多久刷新一次（想试可改小，比如 20）
        SHELF_COLS: 6,
        SHELF_ROWS: 6,
        TRADE_COLS: 4,
        TRADE_ROWS: 4
    },

    // ---- 背包界面设置 ----
    BACKPACK: {
        BG_KEY: 'backpack_bg',                          // 背包底图的贴图key
        BG_PATH: 'assets/images/ui/beibaojiemian2.png', // 背包底图路径
        // 网格在底图上的区域（像素，相对原图2528x1696）
        // 这些值用来定位"深色内部区域"，可按实际底图微调
        GRID_COLS: 9,        // 网格列数
        GRID_ROWS: 5,        // 网格行数
        GRID_RECT: { x: 436, y: 490, w: 1656, h: 896 }, // 网格区域在底图上的像素矩形（整体缩小约20%、下移半格、居中）
        // 开局解锁的格子（相对网格左上角的列行），其余为锁定状态
        // 居中 3 行 × 4 列，拾取背包后解锁这些
        INITIAL_UNLOCK: [
            [2,1],[3,1],[4,1],[5,1],
            [2,2],[3,2],[4,2],[5,2],
            [2,3],[3,3],[4,3],[5,3]
        ],
        // 测试物品开关：true 时捡到背包会塞短弓+贴着的铁箭、匕首、粗布衣、面包，方便试战斗
        // 看完效果想关掉，把这里改成 false 即可
        // 开局测试物：匕首、药水、解毒、假钥匙、火把、面包（已去掉毒药/贤者药剂，互不重叠）
        SEED_TEST_ITEMS: true,
        // 测试用扩展点：拾取背包时给几个，方便试解锁。以后升级系统会改成升级发点
        // 看完效果想关掉，把这里改成 0 即可
        SEED_EXPAND_POINTS: 3,
        // 物品稀有度颜色（占用的格子会变成这个颜色）
        RARITY_COLORS: {
            common: 0xa6e3a1,      // 普通：绿
            rare: 0x89b4fa,        // 稀有：蓝
            epic: 0xcba6f7,        // 史诗：紫
            legendary: 0xf9e2af,   // 传说：金
            artifact: 0xf38ba8     // 神器：红
        },
        // 随身暂存：格子外最多带几件还不强制打开背包
        // 开局 0 = 每捡一件都必须立刻整理（规则A）
        // 以后成长调用 GameState.addStashSlots(1)，建议上限 3
        STASH_SLOTS_START: 0,
        STASH_SLOTS_MAX: 3
    },

    // ---- 容器（箱子）界面：按锁等级换底图和容量 ----
    // lockLevel 1=木箱4x3  2=铁箱4x4  3=金箱5x4
    // GRID_RECT 是格子在底图原图像素上的位置，若对不齐告诉我偏哪边即可调
    CHESTS: {
        1: {
            key: 'chest_wood',
            path: 'assets/images/ui/muxiangjiemian2.png',
            name: '木箱',
            cols: 4, rows: 3,
            GRID_RECT: { x: 438, y: 432, w: 1524, h: 984 }
        },
        2: {
            key: 'chest_iron',
            path: 'assets/images/ui/tiexiangjiemian.png',
            name: '铁箱',
            cols: 4, rows: 4,
            GRID_RECT: { x: 280, y: 360, w: 1488, h: 1488 }
        },
        3: {
            key: 'chest_gold',
            path: 'assets/images/ui/jinxiangjiemian.png',
            name: '金箱',
            cols: 5, rows: 4,
            GRID_RECT: { x: 436, y: 490, w: 1656, h: 896 }
        }
    },

    // ---- 偷窃相关设置 ----
    STEAL: {
        INTERACT_DISTANCE: 110,     // 离木箱多近才能触发偷窃（像素）
        BORDER_DISPLAY_WIDTH: 1000, // 边框显示宽度（像素），越大边框越大
        SLOT_WIDTH_RATIO: 0.82,      // 内槽占边框宽度的比例（指针只在槽内移动）
        SLOT_HEIGHT_RATIO: 0.45,     // 内槽占边框高度的比例（指针高度按此算）
        TARGET_HEIGHT_RATIO: 0.38,   // 绿色目标区相对内槽高度（越小越扁）
        // 下标 1=木 2=铁 3=金。铁/金明显更快、绿区更窄
        MARKER_MS: [0, 1200, 640, 420],
        TARGET_START: [0, 100, 58, 44],
        TARGET_MIN: [0, 60, 32, 22],
        // 兼容旧字段（木箱兜底）
        TARGET_WIDTH_START: 100,
        TARGET_WIDTH_MIN: 60,
        MARKER_SPEED: 1200,
        SKILL_SLOW_MS: 120,       // 开锁属性每级：指针一趟再慢这么多毫秒
        SKILL_ZONE_PX: 16,        // 开锁属性每级：绿区再宽这么多像素
        NOISE_RADIUS: 320,        // 开锁失败：基础能被听见的距离
        NOISE_PER_LOCK: 50,       // 锁每高一级，声音再传这么远
        INVESTIGATE_SPEED: 90,    // 听见的人走过来的速度（比亨利慢，来得及跑）
        LOOK_MS: 2800,            // 走到了看多久，没人再回家
        SPOT_MS: 4500,            // 看见亨利多盯一会儿
        SPOT_RANGE: 110,          // 走到附近后，亨利还在这么近才算被看见
        NOISE_STEALTH_PCT: 8,     // 潜行每 +1，听见距离少 8%
        NOISE_WANTED_PCT: 12,     // 通缉每级，听见距离再远 12%
        SPOT_WANTED_PCT: 0.12,    // 通缉每级，看见距离再远 12%
        FAKE_NOISE_MUL: 2.5,      // 假钥匙失败：声音再放大这么多倍
        BORDERS: {
            1: 'border_basic',     // 基础木箱专用边框
            2: 'border_medium',    // 铁箱（中级）专用边框
            3: 'border_advanced'   // 金箱（高级）专用边框
        }
    }
};
