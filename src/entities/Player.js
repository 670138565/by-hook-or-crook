/* =====================================================================
 * 玩家实体（Player.js）
 * =====================================================================
 * 作用：定义玩家"亨利"这个角色，用真实美术素材显示，并实现8方位行走。
 *
 * 设计思路：
 *   - 素材只有5个方向（下、左下、左、左上、上），朝右的3个方向用水平翻转实现
 *   - 移动时根据速度方向算出8方位之一，播放对应行走动画
 *   - 停下时播放当前朝向的待机动画
 *   - 碰撞体放在角色脚下（比图片小），俯视角操作更舒服
 * ===================================================================== */
class Player extends Phaser.Physics.Arcade.Sprite {
    /**
     * 创建亨利
     * @param {Phaser.Scene} scene  亨利所在的游戏场景
     * @param {number} x            出生位置 X 坐标
     * @param {number} y            出生位置 Y 坐标
     * @param {number} [scale]      显示缩放；不传则用全局默认（谷仓等）
     */
    constructor(scene, x, y, scale) {
        // 用待机图作为初始纹理
        super(scene, x, y, 'henry_idle');
        scene.add.existing(this);
        scene.physics.add.existing(this);

        // ---- 显示设置 ----
        const s = (scale != null && isFinite(scale) && scale > 0) ? scale : CONFIG.PLAYER_SCALE;
        this.playerScale = s;
        this.setScale(s);
        this.setCollideWorldBounds(false);

        // ---- 碰撞体设置 ----
        // 碰撞体放在角色脚下，比图片小，俯视角操作更舒服
        // 缩放后图片是128x128，碰撞体设为40x40，放在底部居中
        const bodyW = 40;
        const bodyH = 40;
        // offset = (原图宽-碰撞体宽)/2, (原图高-碰撞体高) → 水平居中、贴底
        this.body.setSize(bodyW, bodyH);
        this.body.setOffset(
            (CONFIG.PLAYER_FRAME - bodyW) / 2,
            CONFIG.PLAYER_FRAME - bodyH
        );
        if (this.body.updateFromGameObject) this.body.updateFromGameObject();

        // ---- 键盘控制 ----
        this.cursors = scene.input.keyboard.addKeys('W,A,S,D');
        this.shiftKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

        // ---- 影子 ----
        // 在亨利脚下画一个半透明椭圆当影子，增加立体感
        // 影子先创建，深度比亨利低，这样亨利踩在影子上面
        this.shadow = scene.add.ellipse(x, y, 90 * (s / 0.5), 30 * (s / 0.5), 0x000000);
        this.shadow.setAlpha(0.35);
        if (this.shadow.resetPipeline) this.shadow.resetPipeline();
        this.refreshYSort();           // 按脚底和建筑/摆件比前后

        // ---- 方向状态 ----
        // this.facing 记录当前朝向（0-7），停下时用它决定播哪个待机动画
        // 0=右 1=右下 2=下 3=左下 4=左 5=左上 6=上 7=右上
        this.facing = 2; // 默认朝下
        this.currentAnim = ''; // 当前正在播的动画名，避免重复播放

        // 初始播放朝下的待机动画
        this.playDirectionAnim(2, false);
    }

    /**
     * 根据方位播放对应动画
     * @param {number} sector  0-7 的方位编号
     * @param {boolean} moving 是否在移动（true=行走动画，false=待机动画）
     */
    playDirectionAnim(sector, moving) {
        // 方位 → (动画基础名, 是否水平翻转)
        // 朝右的3个方向复用左边的动画，靠 flipX 翻转
        const DIR_MAP = [
            { anim: 'left',     flip: true  }, // 0 右   ← 复用"左"翻转
            { anim: 'downleft', flip: true  }, // 1 右下 ← 复用"左下"翻转
            { anim: 'down',     flip: false }, // 2 下
            { anim: 'downleft', flip: false }, // 3 左下
            { anim: 'left',     flip: false }, // 4 左
            { anim: 'upleft',   flip: false }, // 5 左上
            { anim: 'up',       flip: false }, // 6 上
            { anim: 'upleft',   flip: true  }  // 7 右上 ← 复用"左上"翻转
        ];
        const info = DIR_MAP[sector];
        const animName = (moving ? 'walk_' : 'idle_') + info.anim;

        // 设置水平翻转
        this.setFlipX(info.flip);

        // 只在动画变化时才切换，避免每帧重复播放导致动画卡在第一帧
        if (this.currentAnim !== animName) {
            this.play(animName);
            this.currentAnim = animName;
        }
    }

    /**
     * 根据移动速度算出8方位编号
     * @param {number} vx  水平速度
     * @param {number} vy  垂直速度
     * @returns {number} 0-7 的方位编号
     */
    getSector(vx, vy) {
        // atan2 返回弧度，转成角度后归一化到 0-360
        const angle = Math.atan2(vy, vx) * 180 / Math.PI;
        const a = (angle + 360) % 360;
        // 每45度一个扇区，round 后映射到 0-7
        // 0=右(0°) 1=右下(45°) 2=下(90°) 3=左下(135°)
        // 4=左(180°) 5=左上(225°) 6=上(270°) 7=右上(315°)
        return Math.round(a / 45) % 8;
    }

    /**
     * 每帧调用一次：处理玩家移动和动画
     */
    update() {
        let vx = 0;
        let vy = 0;
        if (this.cursors.W.isDown) vy -= 1; // W 往上
        if (this.cursors.S.isDown) vy += 1; // S 往下
        if (this.cursors.A.isDown) vx -= 1; // A 往左
        if (this.cursors.D.isDown) vx += 1; // D 往右

        if (vx !== 0 || vy !== 0) {
            // ---- 正在移动 ----
            // 斜向走时归一化速度，避免斜走更快
            const len = Math.sqrt(vx * vx + vy * vy);
            vx = vx / len;
            vy = vy / len;
            const running = this.shiftKey && this.shiftKey.isDown;
            const mul = running ? (CONFIG.PLAYER_RUN_MULTIPLIER || 1.5) : 1;
            const scaleMul = (this.playerScale || CONFIG.PLAYER_SCALE) / (CONFIG.PLAYER_SCALE || 0.5);
            this.setVelocity(vx * CONFIG.PLAYER_SPEED * mul * scaleMul, vy * CONFIG.PLAYER_SPEED * mul * scaleMul);
            if (this.anims) this.anims.timeScale = running ? mul : 1;

            // 算出方位并播放行走动画
            this.facing = this.getSector(vx, vy);
            this.playDirectionAnim(this.facing, true);
        } else {
            // ---- 停下 ----
            this.setVelocity(0, 0);
            if (this.anims) this.anims.timeScale = 1;
            // 播放当前朝向的待机动画
            this.playDirectionAnim(this.facing, false);
        }

        // ---- 影子始终跟着亨利脚下 ----
        // 影子放在亨利脚下偏下一点的位置，模拟光照投影
        this.shadow.setPosition(this.x, this.y + this.displayHeight * 0.38);
        this.refreshYSort();
    }

    /**
     * 按脚底 Y 设深度：站得越靠下，越画在前面（和建筑/摆件同一套规则）
     */
    refreshYSort() {
        const feet = this.body ? this.body.bottom : (this.y + this.displayHeight * 0.5);
        const d = WorldManager.ySortDepth(feet) + 0.5;
        this.setDepth(d);
        if (this.shadow) this.shadow.setDepth(d - 0.1);
    }
}
