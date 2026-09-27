/* =====================================================================
 * 可互动物体基类（InteractiveObject.js）
 * =====================================================================
 * 作用：所有"能互动"的物体（木箱、背包、NPC、门等）都继承或使用这个类，
 *       自动获得"靠近时边缘高亮 + 显示按E提示 + 按E触发互动"的能力。
 *
 * 设计思路：
 *   - 把"距离检测、高亮、提示、E键触发"这些通用逻辑集中在这里
 *   - 每个具体物体只要传一个 onInteract 回调（按E时做什么）即可
 *   - 加新可互动物体不用重复写高亮/提示代码，复用这套
 *
 * 边缘高亮：用 Phaser 的 postFX 发光效果（glow），靠近时开启、远离时关闭，
 *          视觉上物体边缘发亮，提示玩家"这个可以互动"。
 * ===================================================================== */
class InteractiveObject extends Phaser.GameObjects.Sprite {
    /**
     * @param {Phaser.Scene} scene     所在场景
     * @param {number} x               x 坐标
     * @param {number} y               y 坐标
     * @param {string} texture          贴图 key
     * @param {object} config            配置：
     *   scale         - 显示缩放
     *   interactRange - 触发互动的距离（默认用 CONFIG.STEAL.INTERACT_DISTANCE）
     *   promptText    - 靠近时显示的提示文字（默认"按 E 互动"）
     *   onInteract    - 按E时执行的回调函数，会传入这个物体本身
     *   lockLevel     - 锁等级（木箱用，0表示非上锁物体）
     *   depth         - 渲染层级
     */
    constructor(scene, x, y, texture, config) {
        super(scene, x, y, texture);
        scene.add.existing(this);

        // ---- 显示设置 ----
        this.setOrigin(0.5);
        if (config.scale) this.setScale(config.scale);
        this.setDepth(config.depth != null ? config.depth : 2);

        // ---- 互动设置 ----
        this.interactRange = config.interactRange || CONFIG.STEAL.INTERACT_DISTANCE;
        this.promptText = config.promptText || '按 E 互动';
        this.onInteract = config.onInteract || function () {};
        this.lockLevel = config.lockLevel || 0;
        this.interactable = config.interactable !== false; // 默认可互动
        this.inRange = false;     // 玩家当前是否在互动范围内

        // ---- 头顶提示文字（默认隐藏）----
        this.prompt = scene.add.text(x, y, this.promptText, {
            fontSize: '16px',
            fill: '#ffe66d',
            backgroundColor: '#00000088',
            padding: { x: 6, y: 4 }
        }).setOrigin(0.5).setDepth(50000).setVisible(false);

        // ---- 边缘高亮（发光效果）----
        // 不在构造时添加，而是"进入范围时添加、离开范围时移除"
        // 这样保证离开范围时一定不亮（比用 active 开关更可靠）
        this._glowOn = false;   // 当前是否处于高亮状态
    }

    /**
     * 开启边缘高亮
     */
    enableHighlight() {
        if (this._glowOn) return;        // 已经开着就不重复加
        this.glow = this.postFX.addGlow(0xffff00, 3, 0, false);
        this._glowOn = true;
    }

    /**
     * 关闭边缘高亮
     */
    disableHighlight() {
        if (!this._glowOn) return;       // 没开就不处理
        this.postFX.clear();              // 移除所有 postFX 效果（这里只有发光）
        this.glow = null;
        this._glowOn = false;
    }

    /**
     * 设置是否可互动（例如木箱开过之后设为不可互动）
     */
    setInteractable(v) {
        this.interactable = v;
        if (!v) {
            this.prompt.setVisible(false);
            this.disableHighlight();
        }
    }

    /**
     * 每帧调用：只算距离，不负责高亮。
     * 多个物体同时在范围内时，由场景选出最近的一个再 setFocused(true)
     * @param {object} player  玩家对象（需要有 x, y）
     * @returns {boolean} 玩家是否在互动范围内
     */
    update(player) {
        if (!this.interactable) {
            this.inRange = false;
            return false;
        }
        const dist = Phaser.Math.Distance.Between(player.x, player.y, this.x, this.y);
        const base = CONFIG.PLAYER_SCALE || 0.5;
        const s = (player && player.playerScale > 0) ? player.playerScale : base;
        const range = this.interactRange * (s / base);
        this.inRange = dist < range;
        return this.inRange;
    }

    /**
     * 设为当前互动目标（只有最近的那一个为 true）
     * true：显示按E提示 + 边缘高亮
     * false：关掉，避免一堆东西同时亮、分不清按E会碰哪个
     */
    setFocused(focused) {
        if (focused && this.interactable && this.inRange) {
            const promptY = this.y - this.displayHeight / 2 - 15;
            this.prompt.setVisible(true).setPosition(this.x, promptY);
            this.enableHighlight();
        } else {
            this.prompt.setVisible(false);
            this.disableHighlight();
        }
    }

    /**
     * 尝试互动（玩家按E时由场景调用）：在范围内且可互动时执行回调
     */
    tryInteract() {
        if (this.interactable && this.inRange && this.onInteract) {
            this.onInteract(this);
        }
    }

    static sectorFrom(dx, dy) {
        if (!dx && !dy) return 2;
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const a = (angle + 360) % 360;
        return Math.round(a / 45) % 8;
    }

    enableNpcWalk(itemData, scale) {
        const id = (itemData && (itemData.npcId || itemData.dialogueId)) || '';
        const mgr = this.scene && this.scene.anims;
        if (!id || !mgr || !mgr.exists('npc_' + id + '_idle_down')) return false;
        const spec = window.DialogueDB && DialogueDB.spriteOf && DialogueDB.spriteOf(id);
        if (!spec || !this.scene.textures.exists(spec.idleKey)) return false;
        this._npcId = id;
        this._npcFacing = 2;
        let s = (scale != null && isFinite(scale) && scale > 0) ? scale : 0;
        if (!(s > 0) && this.scene.player && this.scene.player.playerScale > 0) {
            s = this.scene.player.playerScale;
        }
        if (!(s > 0)) {
            const mk = this.scene.currentMapKey;
            const m = mk && window.WorldManager && WorldManager.world && WorldManager.world.maps[mk];
            if (m && m.playerScale > 0) s = m.playerScale;
        }
        if (!(s > 0)) s = CONFIG.PLAYER_SCALE || 0.5;
        const showH = (CONFIG.PLAYER_FRAME || 256) * s;
        this.setTexture(spec.idleKey, 0);
        this.setDisplaySize(showH, showH);
        this.playNpcDir(2, false);
        return true;
    }

    playNpcDir(sector, moving) {
        if (!this._npcId || !this.scene || !this.scene.anims) return;
        const map = InteractiveObject.DIR_MAP;
        const info = map[((sector % 8) + 8) % 8];
        const key = 'npc_' + this._npcId + (moving ? '_walk_' : '_idle_') + info.anim;
        if (!this.scene.anims.exists(key)) return;
        this.setFlipX(!!info.flip);
        this._npcFacing = ((sector % 8) + 8) % 8;
        if (this._npcAnimName !== key) {
            this.play(key);
            this._npcAnimName = key;
        }
    }
}

InteractiveObject.DIR_MAP = [
    { anim: 'left',     flip: true  },
    { anim: 'downleft', flip: true  },
    { anim: 'down',     flip: false },
    { anim: 'downleft', flip: false },
    { anim: 'left',     flip: false },
    { anim: 'upleft',   flip: false },
    { anim: 'up',       flip: false },
    { anim: 'upleft',   flip: true  }
];
