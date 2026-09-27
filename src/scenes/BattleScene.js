/* =====================================================================
 * 战斗场景（BattleScene.js）
 * 背包即战场：点已放入的武器/弓弩/盾/药。弓弩只射发射一侧贴着的箭。
 * 生命和走路共用。能量读物品表。Esc 逃跑，空格结束回合。
 * ===================================================================== */
class BattleScene extends Phaser.Scene {
    constructor() {
        super({ key: CONFIG.SCENES.BATTLE });
    }

    init(data) {
        this.payload = data || {};
        this.finished = false;
        this.busy = false;
        this.hoverIt = null;
        this.itemSprites = [];
    }

    create() {
        const W = this.scale.width;
        const H = this.scale.height;
        this._hidden = [];
        [CONFIG.SCENES.GAME, CONFIG.SCENES.DIALOGUE].forEach(k => {
            if (this.scene.isVisible(k)) {
                this.scene.setVisible(false, k);
                this._hidden.push(k);
            }
        });
        this.add.rectangle(W / 2, H / 2, W, H, 0x11111b, 1).setScrollFactor(0).setDepth(0);
        if (window.AudioSys) AudioSys.playMusic(this, 'bgm_battle');

        Combat.start({
            enemyId: this.payload.enemyId,
            enemyName: this.payload.enemyName,
            enemyKind: this.payload.enemyKind,
            enemies: this.payload.enemies,
            caught: !!this.payload.caught
        });

        this.placePortrait('henry', W * 0.14, H - 52);
        this.placePortrait('npc', W * 0.86, H - 52);

        this.add.text(W / 2, 16, '战斗', {
            fontSize: '26px', fill: '#f9e2af', fontStyle: 'bold'
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(8);

        this.pStat = this.add.text(W * 0.22, 48, '', {
            fontSize: '18px', fill: '#a6e3a1'
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(8);
        this.ePanel = [];
        this.turnStat = this.add.text(W / 2, 48, '', {
            fontSize: '18px', fill: '#cdd6f4'
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(8);

        this.layoutGrid();
        this.gridGfx = this.add.graphics().setDepth(2);
        this.hoverGfx = this.add.graphics().setDepth(4);
        this.drawGrid();
        this.spawnItems();

        this.logText = this.add.text(W / 2, this.grid.bottom + 12, '', {
            fontSize: '16px', fill: '#cdd6f4',
            wordWrap: { width: Math.min(W - 80, 720) },
            align: 'center',
            lineSpacing: 4
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(8);

        this.hint = this.add.text(W / 2, H - 18, '点格子出招    点右侧选目标（1/2/3）    空格结束回合    Esc 逃跑    F 伏法', {
            fontSize: '14px', fill: '#6c7086'
        }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(8);

        this.btnEnd = this.makeBtn(W / 2 - 140, H - 56, window.t('battle.endTurn', '结束回合'), '#a6e3a1', () => this.doEndTurn());
        this.btnFlee = this.makeBtn(W / 2 + 20, H - 56, '逃跑', '#f9e2af', () => this.doFlee());
        this.btnSurrender = this.makeBtn(W / 2 + 160, H - 56, '伏法', '#f38ba8', () => this.doSurrender());

        this.toast = this.add.text(W / 2, H * 0.42, '', {
            fontSize: '22px', fill: '#f9e2af', fontStyle: 'bold',
            stroke: '#000000', strokeThickness: 5
        }).setOrigin(0.5).setScrollFactor(0).setDepth(12).setAlpha(0);

        this.refreshHud();
        this.input.keyboard.on('keydown', this.onKey, this);
        this.events.once('shutdown', () => {
            this.input.keyboard.off('keydown', this.onKey, this);
            (this.ePanel || []).forEach(p => {
                if (p.bg) p.bg.destroy();
                if (p.text) p.text.destroy();
            });
            this.ePanel = [];
            (this._hidden || []).forEach(k => this.scene.setVisible(true, k));
            if (window.AudioSys) AudioSys.playMusic(this, 'bgm_main');
            Combat.state = null;
        });
    }

    layoutGrid() {
        const W = this.scale.width;
        const H = this.scale.height;
        const cols = CONFIG.BACKPACK.GRID_COLS;
        const rows = CONFIG.BACKPACK.GRID_ROWS;
        const cell = Math.floor(Math.min((W * 0.52) / cols, (H * 0.48) / rows, 70));
        const blockW = cell * cols;
        const blockH = cell * rows;
        this.grid = {
            cols: cols, rows: rows, cell: cell,
            startX: Math.round(W / 2 - blockW / 2),
            startY: 86,
            bottom: 86 + blockH
        };
    }

    cellRect(c, r) {
        const g = this.grid;
        return { x: g.startX + c * g.cell, y: g.startY + r * g.cell, s: g.cell };
    }

    drawGrid() {
        const g = this.gridGfx;
        g.clear();
        const occ = Combat.occupyMap();
        for (let r = 0; r < this.grid.rows; r++) {
            for (let c = 0; c < this.grid.cols; c++) {
                const rc = this.cellRect(c, r);
                const unlocked = GameState.isCellUnlocked(c, r);
                if (!unlocked) {
                    g.fillStyle(0x1a1a1a, 0.7).fillRect(rc.x + 2, rc.y + 2, rc.s - 4, rc.s - 4);
                    g.lineStyle(1, 0x313244, 0.7).strokeRect(rc.x + 2, rc.y + 2, rc.s - 4, rc.s - 4);
                    continue;
                }
                g.fillStyle(0x2b2b2b, 0.9).fillRect(rc.x + 2, rc.y + 2, rc.s - 4, rc.s - 4);
                g.lineStyle(2, 0x45475a, 0.9).strokeRect(rc.x + 2, rc.y + 2, rc.s - 4, rc.s - 4);
                const it = occ[c + ',' + r];
                if (it) {
                    const color = this.rarityColor(it);
                    g.fillStyle(color, 0.28).fillRect(rc.x + 2, rc.y + 2, rc.s - 4, rc.s - 4);
                    g.lineStyle(2, color, 0.95).strokeRect(rc.x + 2, rc.y + 2, rc.s - 4, rc.s - 4);
                }
            }
        }
    }

    rarityColor(it) {
        const colors = (CONFIG.BACKPACK && CONFIG.BACKPACK.RARITY_COLORS) || {};
        return colors[(it && it.rarity) || 'common'] || 0xa6e3a1;
    }

    spawnItems() {
        this.itemSprites.forEach(e => {
            if (e.sprite) e.sprite.destroy();
            if (e.label) e.label.destroy();
        });
        this.itemSprites = [];
        Combat.placedItems().forEach(it => this.createItemSprite(it));
    }

    footprint(it) {
        return ((it.rot || 0) % 2 === 1)
            ? { dw: it.h || 1, dh: it.w || 1 }
            : { dw: it.w || 1, dh: it.h || 1 };
    }

    createItemSprite(it) {
        const { dw, dh } = this.footprint(it);
        const cell = this.grid.cell;
        const cx = this.grid.startX + it.col * cell + dw * cell / 2;
        const cy = this.grid.startY + it.row * cell + dh * cell / 2;
        const key = (it.image && this.textures.exists('item:' + it.image))
            ? ('item:' + it.image)
            : 'item:missing';
        const tex = ItemDB.texSize(this, it);
        const art = ItemDB.fitArt(it, cell, tex.w, tex.h, 8);
        const sprite = this.add.image(cx, cy, key).setDisplaySize(art.w, art.h).setDepth(5);
        sprite.setAngle((it.rot || 0) * 90);
        if (window.ItemDB && ItemDB.tintPoisoned) ItemDB.tintPoisoned(sprite, it);
        sprite.setInteractive({ useHandCursor: true });
        sprite.on('pointerover', () => this.onHover(it));
        sprite.on('pointerout', () => this.clearHover());
        sprite.on('pointerdown', () => this.onUse(it));
        const label = this.add.text(cx, cy + dh * cell / 2 - 10, (ItemDB.displayName ? ItemDB.displayName(it) : (it.name || '')), {
            fontSize: '12px', fill: '#cdd6f4', stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5, 1).setDepth(6);
        this.itemSprites.push({ it: it, sprite: sprite, label: label });
    }

    findEntry(it) {
        return this.itemSprites.find(e => e.it === it);
    }

    onHover(it) {
        this.hoverIt = it;
        this.hoverGfx.clear();
        let bitsCharge = '';
        if (ItemDB.isLauncher(it)) {
            ItemDB.fireSideCells(it).forEach(p => {
                if (p.c < 0 || p.r < 0 || p.c >= this.grid.cols || p.r >= this.grid.rows) return;
                const rc = this.cellRect(p.c, p.r);
                this.hoverGfx.fillStyle(0xf9e2af, 0.35).fillRect(rc.x + 2, rc.y + 2, rc.s - 4, rc.s - 4);
                this.hoverGfx.lineStyle(2, 0xf9e2af, 1).strokeRect(rc.x + 2, rc.y + 2, rc.s - 4, rc.s - 4);
            });
            Combat.arrowsTouching(it).forEach(ar => {
                ItemDB.worldCells(ar).forEach(p => {
                    const rc = this.cellRect(p.c, p.r);
                    this.hoverGfx.lineStyle(3, 0xa6e3a1, 1).strokeRect(rc.x + 1, rc.y + 1, rc.s - 2, rc.s - 2);
                });
            });
            const launch = ItemDB.combatEffects(it).find(e => e && e.type === 'launcher') || {};
            if (launch.charge && Combat.state) {
                const cur = (Combat.state.charges || {})[it.id] || 0;
                bitsCharge = '充能 ' + cur + '/' + launch.charge;
            }
        }
        const cbt = ItemDB.combatOf(it) || {};
        const bits = [(ItemDB.displayName ? ItemDB.displayName(it) : (it.name || '物品'))];
        if (bitsCharge) bits.push(bitsCharge);
        if (ItemDB.isCombatConsumable(it)) bits.push('用完消失');
        else if (cbt.energy) bits.push(window.t('ui.energy', '能量') + ' ' + cbt.energy);
        if (cbt.dmg) bits.push('伤 ' + cbt.dmg);
        if (cbt.shield && ItemDB.combatCat(it) === 'shield') bits.push('盾 +' + cbt.shield);
        const def = ItemDB.defOf(it);
        if (def && def.mechanic) bits.push(def.mechanic);
        this.hint.setText(bits.join('    '));
    }

    clearHover() {
        this.hoverIt = null;
        this.hoverGfx.clear();
        this.hint.setText('点格子里的武器 / 消耗品 / 弓弩 / 盾 / 药    空格结束回合    Esc 逃跑    F 伏法');
    }

    onUse(it) {
        if (this.finished || this.busy) return;
        const r = Combat.useItem(it);
        if (!r || !r.ok) {
            this.showToast((r && r.msg) || '用不了。');
            this.refreshHud();
            return;
        }
        if (r.consumed) {
            const entry = this.findEntry(it);
            if (entry) {
                if (entry.sprite) entry.sprite.destroy();
                if (entry.label) entry.label.destroy();
                this.itemSprites = this.itemSprites.filter(e => e !== entry);
            }
            this.drawGrid();
            if (window.AudioSys) {
                const cat = ItemDB.combatCat(it);
                AudioSys.sfx(this, cat === 'potion' ? 'sfx_use_potion' : 'sfx_item_use');
            }
        }
        this.refreshHud();
        this.playHitFx();
        if (Combat.state && Combat.state.finished) this.afterEnd();
    }

    placePortrait(side, x, y) {
        const pos = { x: x, y: y };
        if (side === 'henry') this.henryPos = pos;
        else this.npcPos = pos;
        const db = window.DialogueDB;
        let file = '';
        if (side === 'henry' && db) file = db.portraitFile(db.henry, '');
        else file = this.payload.enemyPortrait || (db ? db.portraitFile(db.get(this.payload.enemyId), '') : '');
        const key = file ? ('npcport_' + file) : '';
        if (!key || !this.textures.exists(key)) return;
        const spr = this.add.image(x, y, key).setOrigin(0.5, 1).setScrollFactor(0).setDepth(1);
        if (side === 'henry') this.henrySprite = spr;
        else this.npcSprite = spr;
        const H = this.scale.height;
        const W = this.scale.width;
        const srcH = Math.max(1, spr.height);
        const srcW = Math.max(1, spr.width);
        let scale = (H * 0.55) / srcH;
        const maxW = W * 0.18;
        if (srcW * scale > maxW) scale = maxW / srcW;
        spr.setScale(scale);
        spr.setAlpha(0.85);
    }

    makeBtn(x, y, label, color, fn) {
        const bg = this.add.rectangle(x, y, 160, 42, 0x1e1e2e, 0.95)
            .setStrokeStyle(2, 0xcba6f7).setScrollFactor(0).setDepth(9)
            .setInteractive({ useHandCursor: true });
        const t = this.add.text(x, y, label, {
            fontSize: '20px', fill: color, fontStyle: 'bold'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(10);
        bg.on('pointerdown', fn);
        t.setInteractive({ useHandCursor: true }).on('pointerdown', fn);
        return { bg: bg, text: t };
    }

    setButtons(on) {
        const alpha = on ? 1 : 0.4;
        [this.btnEnd, this.btnFlee, this.btnSurrender].forEach(b => {
            if (!b) return;
            b.bg.setAlpha(alpha);
            b.text.setAlpha(alpha);
            if (on) {
                b.bg.setInteractive({ useHandCursor: true });
                b.text.setInteractive({ useHandCursor: true });
            } else {
                b.bg.disableInteractive();
                b.text.disableInteractive();
            }
        });
    }

    playerHp() {
        return window.GameState ? GameState.get('生命', 0) : 0;
    }

    playerMax() {
        return window.GameState ? GameState.get('生命上限', 30) : 30;
    }

    refreshHud() {
        const s = Combat.state;
        if (!s) return;
        this.pStat.setText(window.t('npc.henry.name', '亨利') + '  ' + window.t('ui.hp', '生命') + ' ' + this.playerHp() + '/' + this.playerMax()
            + '  ' + window.t('ui.level', '等级') + ' ' + (GameState.get('等级', 1) || 1)
            + '  ' + window.t('ui.shield', '护盾') + ' ' + (s.playerShield || 0)
            + (s.playerPoison ? ('  ' + window.t('battle.shortPoison', '毒') + s.playerPoison) : '')
            + (s.playerBurn ? ('  ' + window.t('battle.shortBurn', '燃') + s.playerBurn) : '')
            + (s.playerStun ? ('  ' + window.t('battle.shortStun', '晕')) : '')
            + (s.nextPoison ? ('  ' + window.t('battle.nextPoison', '抹毒') + s.nextPoison) : '')
            + (GameState.wanted && GameState.wanted() ? ('  ' + window.t('battle.wanted', '通缉') + GameState.wanted()) : ''));
        this.refreshEnemyPanel();
        this.turnStat.setText(window.t('battle.turn', '第 {n} 回合', { n: s.turn }) + '    ' + window.t('ui.energy', '能量') + ' ' + s.energy + '/' + s.energyMax);
        this.logText.setText((s.log || []).slice(-5).join('\n'));
        this.drawGrid();
    }

    enemyLine(en) {
        if (!en) return '';
        const dead = en.dead || en.hp <= 0;
        return (dead ? window.t('battle.deadMark', '（倒）') : '') + en.name
            + '\n' + window.t('ui.hp', '生命') + ' ' + Math.max(0, en.hp) + '/' + en.maxHp
            + '  ' + window.t('ui.shield', '护盾') + ' ' + (en.shield || 0)
            + (en.poison ? ('  ' + window.t('battle.shortPoison', '毒') + en.poison) : '')
            + (en.burn ? ('  ' + window.t('battle.shortBurn', '燃') + en.burn) : '')
            + (en.stun ? ('  ' + window.t('battle.shortStun', '晕')) : '');
    }

    refreshEnemyPanel() {
        const s = Combat.state;
        (this.ePanel || []).forEach(p => {
            if (p.bg) p.bg.destroy();
            if (p.text) p.text.destroy();
        });
        this.ePanel = [];
        if (!s) return;
        const W = this.scale.width;
        const cur = Combat.currentTarget();
        const list = s.enemies || [];
        const cardW = Math.min(240, W * 0.26);
        let x = (this.grid ? this.grid.startX + this.grid.cols * this.grid.cell : W * 0.72) + cardW / 2 + 18;
        if (x + cardW / 2 > W - 12) x = W - 12 - cardW / 2;
        list.forEach((en, i) => {
            const y = 78 + i * 62;
            const on = cur && cur.uid === en.uid;
            const dead = !!(en.dead || en.hp <= 0);
            const bg = this.add.rectangle(x, y, cardW, 56, 0x1e1e2e, 0.94)
                .setStrokeStyle(2, on ? 0xf9e2af : 0x45475a)
                .setScrollFactor(0).setDepth(9);
            const t = this.add.text(x, y, this.enemyLine(en), {
                fontSize: '15px', fill: dead ? '#6c7086' : '#e64553', align: 'center',
                lineSpacing: 4
            }).setOrigin(0.5).setScrollFactor(0).setDepth(10);
            if (!dead) {
                const pick = () => this.pickEnemy(en);
                bg.setInteractive({ useHandCursor: true }).on('pointerdown', pick);
                t.setInteractive({ useHandCursor: true }).on('pointerdown', pick);
            }
            this.ePanel.push({ bg: bg, text: t, uid: en.uid });
        });
    }

    playHitFx() {
        if (!Combat.takeFxHits) return;
        const hits = Combat.takeFxHits();
        if (hits.length && window.AudioSys) AudioSys.sfx(this, 'sfx_hit', 0.6);
        hits.forEach((h, i) => {
            this.time.delayedCall(i * 80, () => this.showHit(h));
        });
    }

    showHit(h) {
        if (!h || !this.add) return;
        const isPlayer = h.side === 'player';
        const spr = isPlayer ? this.henrySprite : this.npcSprite;
        const pos = isPlayer ? this.henryPos : this.npcPos;
        const cx = spr ? spr.x : (pos ? pos.x : this.scale.width * (isPlayer ? 0.14 : 0.86));
        const foot = spr ? spr.y : (pos ? pos.y : this.scale.height - 52);
        const dh = spr && spr.displayHeight ? spr.displayHeight : this.scale.height * 0.5;
        const dw = spr && spr.displayWidth ? spr.displayWidth : this.scale.width * 0.16;
        const cy = foot - dh * 0.5;

        const flash = this.add.rectangle(cx, cy, dw * 0.92, dh * 0.92, 0xff2233, 0.5)
            .setDepth(12).setScrollFactor(0);
        this.tweens.add({
            targets: flash, alpha: 0, duration: 240,
            onComplete: () => flash.destroy()
        });

        const g = this.add.graphics().setDepth(13).setScrollFactor(0);
        g.lineStyle(7, 0xffffff, 0.95);
        g.beginPath();
        g.moveTo(cx - dw * 0.26, cy - dh * 0.2);
        g.lineTo(cx + dw * 0.26, cy + dh * 0.2);
        g.moveTo(cx + dw * 0.26, cy - dh * 0.2);
        g.lineTo(cx - dw * 0.26, cy + dh * 0.2);
        g.strokePath();
        this.tweens.add({
            targets: g, alpha: 0, delay: 60, duration: 200,
            onComplete: () => g.destroy()
        });

        if (spr && spr.active) {
            const ox = spr.x;
            this.tweens.add({
                targets: spr, x: ox + (isPlayer ? 16 : -16), duration: 36, yoyo: true, repeat: 3,
                onComplete: () => { if (spr.active) spr.x = ox; }
            });
            spr.setTint(0xff5555);
            this.time.delayedCall(220, () => {
                if (spr.active && spr.clearTint) spr.clearTint();
            });
        }

        if (!isPlayer) {
            const card = (this.ePanel || []).find(p => p.uid === h.uid);
            if (card && card.bg && card.bg.active) {
                card.bg.setFillStyle(0x7f1d1d, 1);
                this.time.delayedCall(220, () => {
                    if (card.bg && card.bg.active) card.bg.setFillStyle(0x1e1e2e, 0.94);
                });
            }
        }

        const num = this.add.text(cx, cy - dh * 0.28, '-' + h.n, {
            fontSize: '34px', fill: '#ff4d4d', fontStyle: 'bold',
            stroke: '#1a0505', strokeThickness: 5
        }).setOrigin(0.5).setDepth(14).setScrollFactor(0);
        this.tweens.add({
            targets: num, y: num.y - 42, alpha: 0, duration: 560,
            onComplete: () => num.destroy()
        });
    }

    pickEnemy(en) {
        if (this.finished || this.busy) return;
        if (!Combat.setTarget(en)) return;
        this.refreshEnemyPanel();
        this.showToast('目标：' + en.name);
    }

    showToast(msg) {
        this.toast.setText(msg);
        this.tweens.killTweensOf(this.toast);
        this.toast.setAlpha(1);
        this.tweens.add({
            targets: this.toast, alpha: 0, delay: 900, duration: 280
        });
    }

    onKey(e) {
        if (this.finished || this.busy) return;
        const k = e.key;
        if (k === 'Escape') this.doFlee();
        else if (k === 'f' || k === 'F') this.doSurrender();
        else if (k === ' ' || k === 'Enter') this.doEndTurn();
        else if (k === '1' || k === '2' || k === '3') {
            Combat.setTargetIndex(parseInt(k, 10) - 1);
            this.refreshEnemyPanel();
        }
    }

    doEndTurn() {
        if (this.finished || this.busy) return;
        this.busy = true;
        this.setButtons(false);
        const r = Combat.enemyPhase();
        this.refreshHud();
        this.playHitFx();
        if (r && r.ended) {
            this.afterEnd();
            return;
        }
        this.time.delayedCall(500, () => {
            if (this.finished) return;
            this.busy = false;
            this.setButtons(true);
            this.refreshHud();
        });
    }

    doFlee() {
        if (this.finished || this.busy) return;
        Combat.flee();
        this.afterEnd();
    }

    doSurrender() {
        if (this.finished || this.busy) return;
        if (!Combat.surrender) return;
        Combat.surrender();
        this.afterEnd();
    }

    afterEnd() {
        if (this.finished) return;
        this.finished = true;
        this.busy = true;
        this.setButtons(false);
        const s = Combat.state || {};
        this.refreshHud();
        this.logText.setText(s.lootLine || (s.won ? window.t('battle.win', '你赢了。') : (s.fled ? window.t('battle.fled', '你跑了。') : (s.surrendered ? window.t('battle.surrendered', '你举手伏法。') : window.t('battle.downed', '你倒下了，被拿下了。')))));
        const enemies = s.enemies || [];
        const payload = {
            won: !!s.won,
            fled: !!s.fled,
            surrendered: !!s.surrendered,
            caught: !!(this.payload && this.payload.caught),
            enemyId: this.payload.enemyId,
            enemyIds: enemies.map(en => en.npcId).filter(Boolean),
            enemyKinds: enemies.map(en => en.kind).filter(Boolean),
            lootLine: s.lootLine || ''
        };
        this.time.delayedCall(900, () => {
            this.scene.stop();
            if (window.EventBus) EventBus.emit('battle:result', payload);
        });
    }
}
