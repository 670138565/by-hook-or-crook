/* =====================================================================
 * 对话界面（DialogueScene.js）
 * 叠在主游戏上：说话人、台词、选项。E / 空格继续，数字键选选项，Esc 关掉。
 * 节点图：开始/条件自动跳过；NPC/玩家说话后继续；选项点选；结束关掉。
 * ===================================================================== */
class DialogueScene extends Phaser.Scene {
    constructor() {
        super({ key: CONFIG.SCENES.DIALOGUE });
    }

    init(data) {
        this.def = data.dialogue || null;
        this.itemData = data.itemData || null;
        this.caught = !!(data && data.caught);
        this.caughtItemId = (data && data.caughtItemId) || '';
        this.accuse = !!(data && data.accuse);
        this.bribePrice = (data && data.bribePrice) || 0;
        this._closeReport = '';
    }

    create() {
        if (!this.def || !window.DialogueDB) {
            this.closeTalk();
            return;
        }
        this.step = this.stepFrom(DialogueDB.graphStart(this.def));
        if (!this.step || this.step.done) {
            this.closeTalk();
            return;
        }

        const W = this.scale.width;
        const H = this.scale.height;
        const ui = window.UiTheme || {};
        const font = ui.font || '"Microsoft YaHei","微软雅黑",sans-serif';
        this.add.rectangle(W / 2, H / 2, W, H, 0x0a0806, 0.55).setScrollFactor(0).setDepth(0);
        this.npcSpr = null;
        this.henrySpr = null;
        this.npcFile = '';
        this.henryFile = '';

        const boxW = Math.min(Math.floor(W * 0.9), W - 24);
        const boxH = Math.min(Math.floor(H * 0.55), 520);
        const boxY = H - 18 - boxH / 2;
        this.boxBg = this.add.graphics().setScrollFactor(0).setDepth(2);
        this._drawDialogueBox(boxW, boxH, boxY);

        const left = W / 2 - boxW / 2;
        const top = boxY - boxH / 2;
        this.nameText = this.add.text(left + 32, top + 18, '', {
            fontFamily: font,
            fontSize: '24px',
            fill: ui.gold || '#e0c078',
            fontStyle: 'bold',
            padding: { top: 6, bottom: 4, left: 2, right: 2 }
        }).setOrigin(0, 0).setScrollFactor(0).setDepth(3);

        this.bodyText = this.add.text(left + 32, top + 58, '', {
            fontFamily: font,
            fontSize: '20px',
            fill: ui.ink || '#e8dcc8',
            wordWrap: { width: boxW - 64 },
            lineSpacing: 8,
            padding: { top: 6, bottom: 4, left: 2, right: 2 }
        }).setOrigin(0, 0).setScrollFactor(0).setDepth(3);

        this.hintText = this.add.text(left + boxW - 24, top + boxH - 14, 'E / 空格 继续    Esc 离开', {
            fontFamily: font,
            fontSize: '13px',
            fill: ui.muted || '#9a8f7e',
            padding: { top: 4, bottom: 2, left: 2, right: 2 }
        }).setOrigin(1, 1).setScrollFactor(0).setDepth(3);

        this.choiceTexts = [];
        this.choiceHits = [];
        this.boxW = boxW;
        this.boxH = boxH;
        this.boxY = boxY;
        this.boxLeft = left;
        this.boxTop = top;
        this._promptText = '';
        this._promptSpeaker = '';
        this._inBattle = false;
        this._onBattleResult = null;
        this.renderStep();

        this.eKey = this.input.keyboard.addKey('E');
        this.spaceKey = this.input.keyboard.addKey('SPACE');
        this.escKey = this.input.keyboard.addKey('ESC');
        this.numKeys = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n =>
            this.input.keyboard.addKey(String(n))
        );

        this.input.keyboard.on('keydown', this.onKey, this);
        this.events.once('shutdown', () => {
            this.input.keyboard.off('keydown', this.onKey, this);
            this.clearBattleHook();
        });

        if (window.GameState && this.def.id) GameState.set('talked:' + this.def.id, true);
    }

    choicesOf() {
        return (this.step && this.step.choices) ? this.step.choices.filter(c => c && (c.text || '').trim()) : [];
    }

    renderStep() {
        if (!this.step || this.step.done) {
            if (this.step && this.step.report) this._closeReport = this.step.report;
            this.closeTalk();
            return;
        }
        if (this.step.battle) {
            this.startBattle();
            return;
        }
        const fallbackName = (this.def && window.DialogueDB && DialogueDB.npcDisplayName)
            ? DialogueDB.npcDisplayName(this.def, '路人')
            : ((this.def && this.def.name) || window.t('npc.passerby.name', '路人'));
        const choices = this.choicesOf();
        if (!choices.length && this.step.side === 'npc') {
            this._promptText = this.step.text || '';
            this._promptSpeaker = this.step.speaker || fallbackName;
        }

        let speaker = this.step.speaker || fallbackName;
        let body = this.step.text || '……';
        if (choices.length) {
            speaker = this._promptSpeaker || fallbackName;
            body = this._promptText || '';
        }

        this.choiceTexts.forEach(t => t.destroy());
        this.choiceTexts = [];
        (this.choiceHits || []).forEach(h => h.destroy());
        this.choiceHits = [];

        const W = this.scale.width;
        const H = this.scale.height;
        const padX = 32;
        const wrapW = this.boxW - padX * 2;
        const ui = window.UiTheme || {};
        const font = ui.font || '"Microsoft YaHei","微软雅黑",sans-serif';

        this.nameText.setStyle({ wordWrap: { width: wrapW }, fill: ui.gold || '#e0c078' });
        this.nameText.setText(speaker);
        this.bodyText.setStyle({ wordWrap: { width: wrapW }, fill: ui.ink || '#e8dcc8' });
        this.bodyText.setText(body);

        const nameH = Math.max(28, this.nameText.height);
        const bodyH = body ? Math.max(24, this.bodyText.height) : 0;
        let contentH = 18 + nameH + 10 + bodyH;
        if (choices.length) contentH += 14;
        const choiceHeights = [];
        choices.forEach((c, i) => {
            let label = (i + 1) + '.  ' + c.text;
            if (c.check === 'speech') {
                const dc = isFinite(c.dc) ? c.dc : 0;
                label += dc > 0 ? '  （口才 ' + dc + '）' : '  （口才）';
            }
            const probe = this.add.text(0, 0, label, {
                fontFamily: font,
                fontSize: '20px',
                wordWrap: { width: wrapW - 24 },
                lineSpacing: 4,
                padding: { top: 6, bottom: 6, left: 10, right: 10 }
            }).setVisible(false);
            const h = Math.max(36, probe.height + 4);
            choiceHeights.push({ label: label, h: h });
            probe.destroy();
            contentH += h + 8;
        });
        contentH += 28;

        const minH = Math.min(Math.floor(H * 0.38), 300);
        const maxH = Math.floor(H * 0.78);
        this.boxH = Math.max(minH, Math.min(maxH, Math.ceil(contentH)));
        this.boxY = H - 14 - this.boxH / 2;
        this.boxTop = this.boxY - this.boxH / 2;
        this.boxLeft = W / 2 - this.boxW / 2;
        this._drawDialogueBox(this.boxW, this.boxH, this.boxY);

        let y = this.boxTop + 16;
        this.nameText.setPosition(this.boxLeft + padX, y);
        y += nameH + 8;
        this.bodyText.setPosition(this.boxLeft + padX, y);
        y += bodyH + (choices.length ? 12 : 8);

        choices.forEach((c, i) => {
            const meta = choiceHeights[i];
            const hit = this.add.rectangle(
                this.boxLeft + this.boxW / 2,
                y + meta.h / 2,
                this.boxW - 40,
                meta.h,
                0x2a231c,
                0.95
            ).setStrokeStyle(1, 0xc4a574, 0.45).setScrollFactor(0).setDepth(3)
                .setInteractive({ useHandCursor: true });
            hit.on('pointerover', () => hit.setFillStyle(0x3a3128, 1));
            hit.on('pointerout', () => hit.setFillStyle(0x2a231c, 0.95));
            hit.on('pointerdown', () => this.pick(i));
            this.choiceHits.push(hit);

            const t = this.add.text(this.boxLeft + padX + 8, y + 4, meta.label, {
                fontFamily: font,
                fontSize: '19px',
                fill: ui.sage || '#b7c9a3',
                wordWrap: { width: wrapW - 24 },
                lineSpacing: 4,
                padding: { top: 4, bottom: 4, left: 4, right: 4 }
            }).setOrigin(0, 0).setScrollFactor(0).setDepth(4);
            this.choiceTexts.push(t);
            y += meta.h + 8;
        });

        this.hintText.setStyle({ fill: ui.muted || '#9a8f7e' });
        this.hintText.setPosition(this.boxLeft + this.boxW - 20, this.boxTop + this.boxH - 12);
        this.hintText.setText(choices.length
            ? '数字键或点击选项    Esc 离开'
            : 'E / 空格 继续    Esc 离开');
        this.updatePortraits();
        this.flushNotices();
    }

    _drawDialogueBox(boxW, boxH, boxY) {
        if (!this.boxBg) return;
        const W = this.scale.width;
        const left = W / 2 - boxW / 2;
        const top = boxY - boxH / 2;
        this.boxBg.clear();
        this.boxBg.fillStyle(0x16120e, 0.88);
        this.boxBg.fillRoundedRect(left, top, boxW, boxH, 10);
        this.boxBg.lineStyle(1.5, 0xc4a574, 0.55);
        this.boxBg.strokeRoundedRect(left, top, boxW, boxH, 10);
        this.boxBg.lineStyle(2, 0xb8955a, 0.4);
        this.boxBg.lineBetween(left + 18, top + 5, left + 96, top + 5);
    }

    flushNotices() {
        const list = (window.QuestDB && QuestDB.takeNotices()) || [];
        list.forEach((msg, i) => this.showNotice(msg, i));
    }

    showNotice(msg, i) {
        const t = this.add.text(this.scale.width / 2, 28 + i * 36, msg, {
            fontSize: '20px',
            color: '#a6e3a1',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(20);
        this.tweens.add({
            targets: t,
            y: 8 + i * 36,
            alpha: 0,
            delay: 900,
            duration: 800,
            onComplete: () => { if (t.active) t.destroy(); }
        });
    }

    updatePortraits() {
        const db = window.DialogueDB;
        if (this.step.side === 'henry' && this.step.portrait) this.henryFile = this.step.portrait;
        else if (this.step.side === 'npc' && this.step.portrait) this.npcFile = this.step.portrait;
        if (!this.henryFile && db) this.henryFile = db.portraitFile(db.henry, '');
        if (!this.npcFile && db) this.npcFile = db.portraitFile(this.def, '');
        this.applyArt('henry', this.henryFile);
        this.applyArt('npc', this.npcFile);
        if (this.henrySpr) this.henrySpr.setAlpha(this.step.side === 'henry' ? 1 : 0.55);
        if (this.npcSpr) this.npcSpr.setAlpha(this.step.side === 'npc' ? 1 : 0.55);
    }

    applyArt(side, file) {
        const key = file ? ('npcport_' + file) : '';
        const W = this.scale.width;
        const H = this.scale.height;
        const x = side === 'henry' ? W * 0.17 : W * 0.83;
        let spr = side === 'henry' ? this.henrySpr : this.npcSpr;
        if (!key || !this.textures.exists(key)) {
            if (spr) spr.setVisible(false);
            return;
        }
        if (!spr) {
            spr = this.add.image(x, H - 4, key).setOrigin(0.5, 1).setScrollFactor(0).setDepth(1);
            if (side === 'henry') this.henrySpr = spr;
            else this.npcSpr = spr;
        } else {
            spr.setTexture(key);
            spr.setPosition(x, H - 4);
            spr.setVisible(true);
        }
        spr.setScale(1);
        const srcH = Math.max(1, spr.height);
        const srcW = Math.max(1, spr.width);
        const targetH = H * 0.8;
        let scale = targetH / srcH;
        const maxW = side === 'henry' ? W * 0.4 : W * 0.38;
        if (srcW * scale > maxW) scale = maxW / srcW;
        spr.setScale(scale);
    }

    onKey(e) {
        const k = e.key;
        if (k === 'Escape') { this.closeTalk(); return; }
        const choices = this.choicesOf();
        if (choices.length) {
            const n = parseInt(k, 10);
            if (n >= 1 && n <= choices.length) this.pick(n - 1);
            return;
        }
        if (k === 'e' || k === 'E' || k === ' ' || k === 'Enter') this.advance();
    }

    pick(i) {
        const choices = this.choicesOf();
        const c = choices[i];
        if (!c) return;
        if (c.flag && window.GameState && GameState.setFlag) GameState.setFlag(c.flag);
        if (c.check === 'speech') {
            const ok = DialogueDB.speechCheck(c.dc);
            if (!ok) {
                if (c.failRaw) { this.goTo(c.failRaw); return; }
                this.step = {
                    speaker: (this.def && this.def.name) || '路人',
                    text: '他皱了皱眉，没信你的话。',
                    choices: [],
                    nextRaw: null,
                    done: false,
                    side: 'npc',
                    portrait: this.step && this.step.portrait
                };
                this.renderStep();
                return;
            }
        }
        const raw = c.nextRaw || c.next;
        if (!raw) { this.closeTalk(); return; }
        this.goTo(raw);
    }

    advance() {
        if (this.choicesOf().length) return;
        const raw = this.step && (this.step.nextRaw || this.step.next);
        if (!raw) { this.closeTalk(); return; }
        this.goTo(raw);
    }

    stepFrom(raw) {
        const dest = DialogueDB.skipSilent(this.def, raw, false, true);
        this.ensureAlias(dest);
        return DialogueDB.speakInfo(this.def, dest, false);
    }

    /** 老鸦让起化名时问一次。留空就继续叫行商。 */
    ensureAlias(node) {
        if (!node || !node.askAlias || !window.GameState) return;
        if (String(GameState.get('化名', '') || '').trim()) return;
        let raw = '';
        try {
            raw = window.prompt('起一个瓦拉几亚人的名字，用来对付不认识你的人。留空就叫「行商」。', '');
        } catch (e) {
            raw = '';
        }
        const name = String(raw || '').trim().slice(0, 8);
        if (name) GameState.set('化名', name);
    }

    goTo(raw) {
        this.step = this.stepFrom(raw);
        this.renderStep();
    }

    startBattle() {
        if (this._inBattle || !this.step || !this.step.battle) return;
        this._inBattle = true;
        const pending = this.step;
        this._onBattleResult = (r) => {
            this._inBattle = false;
            this._onBattleResult = null;
            const raw = r && r.won ? pending.winRaw : pending.loseRaw;
            if (!raw) {
                this.closeTalk();
                return;
            }
            if (this.scene.isPaused()) this.scene.resume();
            this.goTo(raw);
        };
        if (window.EventBus) EventBus.once('battle:result', this._onBattleResult);
        this.scene.pause();
        this.scene.launch(CONFIG.SCENES.BATTLE, {
            enemyId: pending.enemyId,
            enemyName: pending.enemyName,
            enemyKind: pending.enemyKind,
            enemyPortrait: pending.portrait,
            enemies: pending.enemies,
            caught: !!this.caught
        });
    }

    clearBattleHook() {
        if (this._onBattleResult && window.EventBus) {
            EventBus.off('battle:result', this._onBattleResult);
        }
        this._onBattleResult = null;
        this._inBattle = false;
    }

    closeTalk() {
        this.clearBattleHook();
        if (window.EventBus) {
            let report = this._closeReport || '';
            if (!report && this.accuse) report = 'call';
            EventBus.emit('dialogue:closed', {
                caught: !!this.caught,
                caughtItemId: this.caughtItemId || '',
                accuse: !!this.accuse,
                report: report,
                bribePrice: this.bribePrice || 0
            });
        }
        this.scene.stop();
        this.scene.resume(CONFIG.SCENES.GAME);
    }
}
