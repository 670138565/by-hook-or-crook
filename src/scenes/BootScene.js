/* =====================================================================
 * 启动场景（BootScene.js）
 * 先准备占位图、加载滚动底、亨利行走图，再读配置进 Preload。
 * ===================================================================== */
class BootScene extends Phaser.Scene {
    constructor() {
        super({ key: CONFIG.SCENES.BOOT });
    }

    preload() {
        // 地面瓦片占位
        const groundGfx = this.make.graphics({ x: 0, y: 0, add: false });
        groundGfx.fillStyle(0x4a7c3a, 1);
        groundGfx.fillRect(0, 0, 64, 64);
        groundGfx.generateTexture('ground', 64, 64);
        groundGfx.destroy();

        // 守卫占位
        const guardGfx = this.make.graphics({ x: 0, y: 0, add: false });
        guardGfx.fillStyle(0x2c3e50, 1);
        guardGfx.fillRect(0, 0, 32, 48);
        guardGfx.generateTexture('guard', 32, 48);
        guardGfx.destroy();

        // 加载界面：平铺水印底（可循环滚动）
        this.makeLoadWatermarkTexture();

        // 亨利图提前加载，Preload 一进来就能让他跑
        const frame = CONFIG.PLAYER_FRAME || 256;
        this.load.spritesheet('henry_idle', 'assets/images/players/henry_idle.png', {
            frameWidth: frame,
            frameHeight: frame
        });
        this.load.spritesheet('henry_walk', 'assets/images/players/henry_walk.png', {
            frameWidth: frame,
            frameHeight: frame
        });
    }

    /** 单块水印砖：斜放标题，整屏 tileSprite 平铺后斜向滚动 */
    makeLoadWatermarkTexture() {
        const tw = 360;
        const th = 220;
        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#14110e';
        ctx.fillRect(0, 0, tw, th);

        ctx.save();
        ctx.translate(tw * 0.5, th * 0.42);
        ctx.rotate((-26 * Math.PI) / 180);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 34px "Microsoft YaHei","PingFang SC",sans-serif';
        ctx.fillStyle = 'rgba(196, 165, 116, 0.16)';
        ctx.fillText('盗亦有道', 0, 0);
        ctx.font = '15px "Microsoft YaHei","PingFang SC",sans-serif';
        ctx.fillStyle = 'rgba(154, 143, 126, 0.12)';
        ctx.fillText('作品集试玩', 0, 38);
        ctx.restore();

        // 相邻砖错位感：角上再淡淡盖半个
        ctx.save();
        ctx.translate(tw * 0.08, th * 0.88);
        ctx.rotate((-26 * Math.PI) / 180);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 22px "Microsoft YaHei","PingFang SC",sans-serif';
        ctx.fillStyle = 'rgba(196, 165, 116, 0.08)';
        ctx.fillText('盗亦有道', 0, 0);
        ctx.restore();

        // 给加载页 CSS 平铺用（不走 Phaser TileSprite，避免加载时主线程卡顿）
        window.__loadWmUrl = canvas.toDataURL('image/png');
        window.__loadWmSize = { w: tw, h: th };
    }

    async create() {
        GameState.init();

        await WorldManager.load();
        await ItemDB.load();
        if (window.LootDB) await LootDB.load();
        if (window.ShopDB) await ShopDB.load();
        if (window.DialogueDB) await DialogueDB.load();

        this.scene.start(CONFIG.SCENES.TITLE);
    }
}
