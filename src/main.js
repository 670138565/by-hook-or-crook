/* =====================================================================
 * 游戏启动入口（main.js）
 * =====================================================================
 * 作用：创建 Phaser 游戏实例，注册所有场景，启动第一个场景。
 *
 * 通俗讲：这是游戏的"总开关"。整个游戏只有这一个 Phaser 实例，
 *        它就像一个"游戏机"，把所有场景（启动、加载、主游戏）插进去，
 *        然后按下开机键（启动第一个场景 BootScene）。
 *
 * 执行顺序：
 *   index.html 加载完所有 js 文件 → 走到这里 → 创建游戏 →
 *   BootScene → TitleScene → PreloadScene → GameScene → 玩家开始玩
 * ===================================================================== */
window.addEventListener('load', () => {
    if (location.protocol === 'file:') return;
    // ---- 创建 Phaser 游戏配置 ----
    const config = {
        type: Phaser.AUTO,                    // 渲染器：自动选 WebGL 或 Canvas
        parent: 'game-container',             // 画布塞进 index.html 里的 #game-container
        width: CONFIG.GAME_WIDTH,             // 画布宽
        height: CONFIG.GAME_HEIGHT,           // 画布高
        backgroundColor: CONFIG.BG_COLOR,     // 背景色（透明开启时清屏仍可用相机色）
        transparent: true,                    // 加载页 CSS 水印才能透出来
        physics: CONFIG.PHYSICS,              // 物理引擎设置
        render: {
            antialias: true,
            roundPixels: true                 // 坐标取整，走路不再糊成一片
        },
        // 注册所有场景，按数组顺序，第一个会被自动启动
        scene: [
            BootScene,      // 启动场景（最先跑）
            TitleScene,     // 标题页
            PreloadScene,   // 资源加载场景
            GameScene,      // 主游戏场景
            StealScene,     // 偷窃小游戏场景（按需弹出，不自动启动）
            BackpackScene,  // 背包界面场景（按Tab弹出，不自动启动）
            ShopScene,      // 商店（按E在摊位打开）
            DialogueScene,  // 对话（按E和NPC说话）
            BattleScene     // 战斗（对话节点触发）
        ],
        // 画面缩放策略：让游戏画面自动适应窗口大小，保持比例
        scale: {
            mode: Phaser.Scale.RESIZE,
            autoCenter: Phaser.Scale.CENTER_BOTH
        }
    };

    // ---- 创建游戏实例并启动 ----
    // 这一行真正"开机"，Phaser 会按配置创建画布、初始化物理、启动第一个场景
    window.game = new Phaser.Game(config);
});
