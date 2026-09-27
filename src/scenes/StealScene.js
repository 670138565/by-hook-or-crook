/* =====================================================================
 * 偷窃小游戏场景（StealScene.js）
 * =====================================================================
 * 作用：当玩家按 E 偷箱子时，主游戏暂停，这个场景作为弹窗叠在上面，
 *       玩一个"钓鱼式"开锁小游戏，判定偷窃成功或失败。
 *
 * 小游戏玩法（参考《渔帆暗涌》钓鱼）：
 *   - 屏幕中央有一根横条，一根指针在上面左右弹跳
 *   - 横条上有一段绿色"目标区"
 *   - 按 空格 让指针停下
 *   - 指针停在绿色区内 = 命中（进度+1），停在区外 = 失败
 *   - 命中达到所需次数 = 开锁成功；失败 = 消耗1个开锁器
 *
 * 架构说明：这是个独立场景，叠在 GameScene 之上。GameScene 启动它时会
 *          先暂停自己，本场景结束时通过事件总线（EventBus）通知结果，
 *          再让 GameScene 恢复。这样偷窃逻辑和主游戏完全解耦。
 * ===================================================================== */
class StealScene extends Phaser.Scene {
    constructor() {
        super({ key: CONFIG.SCENES.STEAL });
    }

    /**
     * init：接收启动参数
     * @param {object} data  { target: 木箱对象, lockLevel: 锁的等级(1-3) }
     */
    init(data) {
        this.target = data.target;                 // 被偷的木箱
        this.lockLevel = data.lockLevel || 1;      // 锁等级，越高越难
        this.requiredHits = this.lockLevel + 1;    // 需要命中几次（锁1级=2次）
        this.progress = 0;                          // 已命中次数
        this.finished = false;                      // 是否已结束（防止重复结算）
    }

    create() {
        const W = this.cameras.main.width;
        const H = this.cameras.main.height;
        const cx = W / 2;
        const cy = H / 2;

        // ---- 半透明黑色遮罩（让背景变暗，聚焦小游戏）----
        this.add.rectangle(cx, cy, W, H, 0x000000, 0.6);

        // ---- 标题 ----
        this.add.text(cx, cy - 200, window.t('steal.pickTitle', '开锁中…'), {
            fontSize: '32px', fill: '#ffffff'
        }).setOrigin(0.5);

        // ---- 进度文字 ----
        this.progressText = this.add.text(cx, cy - 155, '进度 0 / ' + this.requiredHits, {
            fontSize: '20px', fill: '#ffe66d'
        }).setOrigin(0.5);

        // ---- 边框贴图（按箱子锁等级使用对应边框）----
        // 边框按 BORDER_DISPLAY_WIDTH 显示，高度按图片原始比例自动算
        const borderKey = CONFIG.STEAL.BORDERS[this.lockLevel] || CONFIG.STEAL.BORDERS[1];
        const borderImg = this.add.image(cx, cy, borderKey).setOrigin(0.5);
        const tex = this.textures.get(borderKey).getSourceImage();
        const borderW = CONFIG.STEAL.BORDER_DISPLAY_WIDTH;
        const borderH = borderW * (tex.height / tex.width);
        borderImg.displayWidth = borderW;
        borderImg.displayHeight = borderH;

        // ---- 计算内槽的位置和尺寸 ----
        // 内槽是边框中间的胶囊形空腔，指针和绿块只在槽内移动/显示
        // 槽占边框宽度的 SLOT_WIDTH_RATIO、高度的 SLOT_HEIGHT_RATIO，且垂直居中
        const slotW = borderW * CONFIG.STEAL.SLOT_WIDTH_RATIO;
        const slotH = borderH * CONFIG.STEAL.SLOT_HEIGHT_RATIO;
        const barLeft = cx - slotW / 2;   // 指针移动范围的最左边
        const barW = slotW;                // 指针移动范围的总宽度

        // 把内槽尺寸存起来，下一轮和结算时要用
        this.barLeft = barLeft;
        this.barW = barW;
        this.slotH = slotH;
        const zoneRatio = (CONFIG.STEAL.TARGET_HEIGHT_RATIO != null) ? CONFIG.STEAL.TARGET_HEIGHT_RATIO : 0.38;
        this.zoneH = Math.max(12, Math.round(slotH * zoneRatio));

        // ---- 绿色目标区（比内槽扁一截，更好辨认停手时机）----
        const targetW = this.getTargetWidth();
        const targetX = barLeft + Phaser.Math.Between(20, barW - targetW - 20);
        this.targetZone = this.add.rectangle(
            targetX + targetW / 2, cy, targetW, this.zoneH, 0x2ecc71, 0.85
        );

        // ---- 指针（高度=内槽高度，刚好嵌在槽里，不溢出边框）----
        this.marker = this.add.rectangle(barLeft, cy, 6, slotH, 0xffffff);
        // 用 tween 让指针在内槽里左右弹跳
        // 速度按锁等级递增：基础木箱最慢，中级较快，高级最快
        this.markerTween = this.tweens.add({
            targets: this.marker,
            x: barLeft + barW,        // 从槽左到槽右
            duration: this.getMarkerDuration(),  // 走完一趟的毫秒数
            yoyo: true,                // 到头后反向走
            repeat: -1,                // 无限循环
            ease: 'Sine.easeInOut'     // 两头慢中间快，像钓鱼线的节奏
        });

        this.canPick = (GameState.get('开锁器', 0) || 0) > 0;
        const keys = GameState.usableKeys ? GameState.usableKeys(this.lockLevel) : [];
        const hintY = cy + borderH / 2 + 36;
        this.add.text(cx, hintY, this.canPick
            ? window.t('steal.lockpickHint2', '按 [空格] 停在绿色区域，或点下面的钥匙')
            : window.t('steal.noPick', '没有开锁器，点下面的钥匙开锁'), {
            fontSize: '18px', fill: '#ffffff'
        }).setOrigin(0.5);

        keys.forEach((k, i) => {
            const x = cx + (i - (keys.length - 1) / 2) * 210;
            const btn = this.add.text(x, hintY + 42, k.label, {
                fontSize: '18px', fill: '#1e1e2e', backgroundColor: '#f9e2af',
                padding: { x: 12, y: 6 }
            }).setOrigin(0.5).setInteractive({ useHandCursor: true });
            btn.on('pointerdown', () => this.useKey(k));
        });

        if (this.canPick) {
            this.spaceKey = this.input.keyboard.addKey('SPACE');
            this.input.keyboard.once('keydown-SPACE', this.tryHit, this);
        } else {
            this.marker.setVisible(false);
            this.targetZone.setVisible(false);
            if (this.markerTween) this.markerTween.stop();
        }
    }

    lockpickSkill() {
        return (window.GameState && GameState.lockpickSkill) ? GameState.lockpickSkill() : 0;
    }

    /**
     * 根据当前进度计算目标区宽度（越往后越窄；开锁技能会加宽绿区）
     */
    getTargetWidth() {
        const st = CONFIG.STEAL || {};
        const lv = Math.max(1, Math.min(3, this.lockLevel || 1));
        const startArr = st.TARGET_START;
        const minArr = st.TARGET_MIN;
        const start = (startArr && startArr[lv] != null) ? startArr[lv] : (st.TARGET_WIDTH_START || 100);
        const min = (minArr && minArr[lv] != null) ? minArr[lv] : (st.TARGET_WIDTH_MIN || 60);
        const t = this.progress / Math.max(1, this.requiredHits);
        const skill = this.lockpickSkill();
        const bonus = skill * (st.SKILL_ZONE_PX || 0);
        let w = Math.max(18, Math.round(start - (start - min) * t + bonus));
        // 新手教程偷窃教学：目标区加宽 70%，更容易停进绿区
        if (window.TutSys && TutSys.inStep('t_steal')) w = Math.max(26, Math.round(w * 1.7));
        return w;
    }

    /**
     * 计算指针走完一趟的毫秒数（越大越慢）
     * 木箱较慢；铁/金明显更快。开锁属性越高越慢。
     */
    getMarkerDuration() {
        const st = CONFIG.STEAL || {};
        const lv = Math.max(1, Math.min(3, this.lockLevel || 1));
        const arr = st.MARKER_MS;
        const base = (arr && arr[lv] != null)
            ? arr[lv]
            : ((st.MARKER_SPEED || 1200) - (lv - 1) * 150);
        const skillSlow = this.lockpickSkill() * (st.SKILL_SLOW_MS || 0);
        let d = Math.max(280, base - this.progress * 90 + skillSlow);
        // 新手教程偷窃教学：指针放慢一倍以上
        if (window.TutSys && TutSys.inStep('t_steal')) d = Math.max(450, Math.round(d * 2.2));
        return d;
    }

    /**
     * 玩家按空格：判定指针是否停在绿色区内
     */
    tryHit() {
        if (this.finished) return;

        // 停下指针
        this.markerTween.stop();

        // 取指针中心 x
        const markerX = this.marker.x;
        // 取目标区左右边界
        const targetLeft = this.targetZone.x - this.targetZone.width / 2;
        const targetRight = this.targetZone.x + this.targetZone.width / 2;

        if (markerX >= targetLeft && markerX <= targetRight) {
            // ---- 命中 ----
            this.progress++;
            this.progressText.setText(window.t('steal.progress', '进度 {a} / {b}', { a: this.progress, b: this.requiredHits }));

            if (this.progress >= this.requiredHits) {
                // 全部命中 → 开锁成功
                this.finish(true);
            } else {
                // 还有下一轮：换一个新的目标区，指针重新弹跳
                this.nextRound();
            }
        } else {
            // ---- 没停准 → 失败 ----
            this.finish(false);
        }
    }

    /**
     * 进入下一轮：重置目标区和指针
     */
    nextRound() {
        // 重新生成更窄的目标区
        const targetW = this.getTargetWidth();
        const targetX = this.barLeft + Phaser.Math.Between(20, this.barW - targetW - 20);
        this.targetZone.x = targetX + targetW / 2;
        this.targetZone.width = targetW;
        this.targetZone.height = this.zoneH || this.targetZone.height;
        this.targetZone.setVisible(true);

        // 指针回到左边，重新弹跳（用统一的速度计算函数，保证难度一致）
        this.marker.x = this.barLeft;
        this.markerTween = this.tweens.add({
            targets: this.marker,
            x: this.barLeft + this.barW,
            duration: this.getMarkerDuration(),
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // 重新监听空格（once 用过就失效了，需要再绑一次）
        this.input.keyboard.once('keydown-SPACE', this.tryHit, this);
    }

    /**
     * 结束小游戏，通知主场景结果
     * @param {boolean} success  是否开锁成功
     */
    useKey(k) {
        if (this.finished || !k || !k.defId) return;
        if (!GameState.consumePlacedDef || !GameState.consumePlacedDef(k.defId)) {
            this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2 + 168,
                '背包里没有这把钥匙了', { fontSize: '20px', fill: '#e74c3c' }).setOrigin(0.5);
            return;
        }
        if (this.markerTween) this.markerTween.stop();
        if (k.type === 'fake_key') {
            const ok = Math.random() * 100 < (k.chance || 50);
            this.finish(ok, { usedKey: true, hugeNoise: !ok });
            return;
        }
        this.finish(true, { usedKey: true });
    }

    finish(success, extra) {
        if (this.finished) return;
        this.finished = true;
        extra = extra || {};
        const cx = this.cameras.main.width / 2;
        const cy = this.cameras.main.height / 2;

        if (success) {
            this.add.text(cx, cy + 130,
                extra.usedKey ? window.t('steal.keySuccess', '钥匙开了！') : window.t('steal.success', '开锁成功！'),
                { fontSize: '28px', fill: '#2ecc71' }).setOrigin(0.5);
        } else if (extra.usedKey) {
            this.add.text(cx, cy + 130,
                '假钥匙拧断了，动静很大！',
                { fontSize: '24px', fill: '#e74c3c' }).setOrigin(0.5);
        } else {
            const left = Math.max(0, (GameState.get('开锁器', 0) || 0) - 1);
            GameState.set('开锁器', left);
            this.add.text(cx, cy + 130,
                window.t('steal.failedMsg', '开锁失败！锁响了一声（开锁器 {n}）', { n: left }),
                { fontSize: '24px', fill: '#e74c3c' }).setOrigin(0.5);
        }

        EventBus.emit('steal:result', {
            success: !!success,
            target: this.target,
            hugeNoise: !!extra.hugeNoise,
            usedKey: !!extra.usedKey
        });

        // 延迟 1.2 秒后关闭小游戏，恢复主游戏
        this.time.delayedCall(1200, () => {
            this.scene.resume(CONFIG.SCENES.GAME);  // 恢复主游戏
            this.scene.stop();                        // 关闭自己
        });
    }
}
