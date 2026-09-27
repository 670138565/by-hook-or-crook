/* =====================================================================
 * 标题页（TitleScene.js）
 * 物品缓缓旋转下落作底；中上方留给艺术字贴图；中下方「开始游戏」。
 * ===================================================================== */
class TitleScene extends Phaser.Scene {
    constructor() {
        super({ key: CONFIG.SCENES.TITLE });
    }

    preload() {
        // 艺术字贴图
        this.load.image('title_logo', 'assets/images/ui/title_logo.png');

        if (window.ItemDB && typeof ItemDB.collectImages === 'function') {
            ItemDB.collectImages().forEach(a => {
                if (!this.textures.exists(a.key)) this.load.image(a.key, a.path);
            });
        }
    }

    create() {
        const w = this.cameras.main.width;
        const h = this.cameras.main.height;
        this.cameras.main.setBackgroundColor(0x12100d);

        this._itemKeys = this.collectTitleItemKeys();
        this._drops = [];
        this._dropCount = Math.min(36, Math.max(22, this._itemKeys.length));
        // 竖条分区：避免左右扎堆、半边空
        this._dropCols = Math.max(5, Math.min(9, Math.round(this._dropCount / 4)));
        this._colCursor = 0;

        for (let i = 0; i < this._dropCount; i++) {
            this.spawnDrop(true, i);
        }

        // 轻暗，保证字和按钮可读
        this.add.rectangle(w / 2, h / 2, w, h, 0x0a0806, 0.38).setDepth(5).setScrollFactor(0);

        this.buildTitleMark(w, h);
        this.buildStartButton(w, h);
        this.buildLangSwitch(w, h);

        this.scale.on('resize', this.onResize, this);
        this.events.once('shutdown', () => {
            this.scale.off('resize', this.onResize, this);
        });
    }

    collectTitleItemKeys() {
        const keys = [];
        if (window.ItemDB && ItemDB.list) {
            ItemDB.list.forEach(def => {
                if (!def || !def.image) return;
                const key = 'item:' + def.image;
                if (this.textures.exists(key)) keys.push(key);
            });
        }
        if (!keys.length && this.textures.exists('item:missing')) keys.push('item:missing');
        return keys;
    }

    pickItemKey() {
        const keys = this._itemKeys;
        if (!keys || !keys.length) return null;
        return keys[Phaser.Math.Between(0, keys.length - 1)];
    }

    colX(col) {
        const w = this.cameras.main.width;
        const cols = this._dropCols || 6;
        const margin = 36;
        const usable = Math.max(80, w - margin * 2);
        const colW = usable / cols;
        const c = ((col % cols) + cols) % cols;
        return margin + c * colW + Phaser.Math.FloatBetween(colW * 0.2, colW * 0.8);
    }

    /** 与其它掉落物是否过近（重生时主要看上方入口） */
    tooCloseToOthers(x, y, skipDrop, minDist) {
        const d2 = minDist * minDist;
        for (let i = 0; i < (this._drops || []).length; i++) {
            const d = this._drops[i];
            if (!d || d === skipDrop || !d.spr || !d.spr.active) continue;
            const dx = d.spr.x - x;
            const dy = d.spr.y - y;
            if (dx * dx + dy * dy < d2) return true;
        }
        return false;
    }

    spawnDrop(scattered, index) {
        const key = this.pickItemKey();
        if (!key) return;
        const h = this.cameras.main.height;
        const cols = this._dropCols || 6;
        const n = Math.max(1, this._dropCount || 1);
        const col = (index != null ? index : this._colCursor++) % cols;

        // 首屏：按序号把高度铺满整屏，再小抖，避免横排「一波」
        let y;
        if (scattered && index != null) {
            const span = h + 160;
            y = (index / n) * span - 80 + Phaser.Math.Between(-28, 28);
        } else {
            y = Phaser.Math.Between(-40, h + 20);
        }

        let x = this.colX(col);
        // 同列过近就换邻条
        for (let k = 0; k < cols && this.tooCloseToOthers(x, y, null, 64); k++) {
            x = this.colX(col + k + 1);
        }

        const spr = this.add.image(x, y, key).setDepth(1).setScrollFactor(0);
        const tw = spr.width || 64;
        const th = spr.height || 64;
        const side = Math.max(tw, th) || 64;
        const target = Phaser.Math.Between(78, 118);
        spr.setScale(target / side);
        spr.setAlpha(Phaser.Math.FloatBetween(0.45, 0.78));
        spr.angle = Phaser.Math.Between(0, 359);

        const drop = {
            spr,
            col: col,
            // 速度差拉大，时间一长就不会齐刷刷出场
            vy: Phaser.Math.FloatBetween(22, 64),
            rot: Phaser.Math.FloatBetween(8, 24) * (Math.random() < 0.5 ? 1 : -1)
        };
        this._drops.push(drop);
    }

    recycleDrop(drop) {
        const key = this.pickItemKey();
        if (key && drop.spr.texture.key !== key) drop.spr.setTexture(key);
        const tw = drop.spr.width || 64;
        const th = drop.spr.height || 64;
        const side = Math.max(tw, th) || 64;
        const target = Phaser.Math.Between(78, 118);
        drop.spr.setScale(target / side);
        drop.spr.setAlpha(Phaser.Math.FloatBetween(0.45, 0.78));

        const cols = this._dropCols || 6;
        let col = drop.col != null ? drop.col : 0;
        let x = 0;
        let y = 0;
        let placed = false;
        // 重生高度拉开到屏幕上方一大段，错开进场时间，别在顶上排成横队
        for (let attempt = 0; attempt < cols * 4; attempt++) {
            col = (drop.col + attempt) % cols;
            x = this.colX(col);
            y = -40 - Phaser.Math.Between(0, 520);
            if (!this.tooCloseToOthers(x, y, drop, 72)) {
                placed = true;
                break;
            }
        }
        if (!placed) {
            x = this.colX(drop.col);
            y = -40 - Phaser.Math.Between(0, 520);
        }

        drop.col = col;
        drop.spr.x = x;
        drop.spr.y = y;
        drop.spr.angle = Phaser.Math.Between(0, 359);
        drop.vy = Phaser.Math.FloatBetween(22, 64);
        drop.rot = Phaser.Math.FloatBetween(8, 24) * (Math.random() < 0.5 ? 1 : -1);
    }

    /** 中上方：有 title_logo 用贴图，否则临时文字占位（方便你之后换艺术字） */
    buildTitleMark(w, h) {
        const cx = w / 2;
        const cy = h * 0.28;
        this._titleRoot = this.add.container(cx, cy).setDepth(20).setScrollFactor(0);

        if (this.textures.exists('title_logo')) {
            const tex = this.textures.get('title_logo');
            const src = tex && tex.getSourceImage && tex.getSourceImage();
            const ok = src && (src.naturalWidth || src.width) > 8;
            if (ok) {
                const logo = this.add.image(0, 0, 'title_logo');
                const maxW = Math.min(w * 0.72, 720);
                const maxH = h * 0.28;
                const sx = maxW / Math.max(1, logo.width);
                const sy = maxH / Math.max(1, logo.height);
                logo.setScale(Math.min(sx, sy) * 2);
                this._titleRoot.add(logo);
                this._titleLogo = logo;
                return;
            }
        }

        const ui = window.UiTheme || {};
        const tip = this.add.text(0, 0, window.t('title.name', '盗亦有道'), {
            fontFamily: ui.fontTitle || ui.font || '"Microsoft YaHei",sans-serif',
            fontSize: '104px',
            fill: ui.gold || '#e0c078',
            fontStyle: 'bold',
            stroke: '#1a1410',
            strokeThickness: 12
        }).setOrigin(0.5);
        const sub = this.add.text(0, 96, window.t('title.logoPlaceholder', '（此处可换成艺术字贴图）'), {
            fontFamily: ui.font || '"Microsoft YaHei",sans-serif',
            fontSize: '26px',
            fill: ui.muted || '#9a8f7e'
        }).setOrigin(0.5).setAlpha(0.75);
        this._titleRoot.add([tip, sub]);
        this._titlePlaceholder = tip;
        this._titlePlaceholderSub = sub;
    }

    buildStartButton(w, h) {
        const ui = window.UiTheme || {};
        const cx = w / 2;
        const cy = h * 0.72;
        this._btnRoot = this.add.container(cx, cy).setDepth(30).setScrollFactor(0);

        const label = window.t('title.start', '开始游戏');
        const padX = 72;
        const padY = 32;
        const txt = this.add.text(0, 0, label, {
            fontFamily: ui.font || '"Microsoft YaHei",sans-serif',
            fontSize: '52px',
            fill: ui.ink || '#e8dcc8',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        const bw = txt.width + padX * 2;
        const bh = txt.height + padY * 2;
        const gfx = this.add.graphics();
        const paint = (hot) => {
            gfx.clear();
            gfx.fillStyle(0x1a1510, hot ? 0.94 : 0.88);
            gfx.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 20);
            gfx.lineStyle(4, hot ? 0xe0c078 : 0xc4a574, hot ? 0.95 : 0.7);
            gfx.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, 20);
            gfx.lineStyle(3, 0xb8955a, hot ? 0.55 : 0.35);
            gfx.lineBetween(-bw / 2 + 28, -bh / 2 + 8, -bw / 2 + Math.min(bw - 56, 180), -bh / 2 + 8);
            gfx.lineStyle(4, 0xe0c078, hot ? 0.35 : 0.18);
            gfx.lineBetween(-bw / 2 + 36, bh / 2 - 6, bw / 2 - 36, bh / 2 - 6);
        };
        paint(false);

        const hit = this.add.zone(0, 0, bw + 16, bh + 16).setInteractive({ useHandCursor: true });
        this._btnRoot.add([gfx, txt, hit]);
        this._btnPaint = paint;
        this._btnGfx = gfx;
        this._btnTxt = txt;
        this._btnBaseScale = 1;

        hit.on('pointerover', () => {
            paint(true);
            txt.setColor(ui.gold || '#e0c078');
            this._btnRoot.setScale(this._btnBaseScale * 1.05);
        });
        hit.on('pointerout', () => {
            paint(false);
            txt.setColor(ui.ink || '#e8dcc8');
            this._btnRoot.setScale(this._btnBaseScale);
        });
        hit.on('pointerdown', () => {
            this._btnRoot.setScale(this._btnBaseScale * 0.97);
        });
        hit.on('pointerup', () => {
            this._btnRoot.setScale(this._btnBaseScale * 1.05);
            this.startGame();
        });

        // 轻微呼吸，不抢戏
        this.tweens.add({
            targets: this._btnRoot,
            y: cy - 4,
            duration: 1600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    /** 右下角语言切换：中文 / English / Español / Português */
    buildLangSwitch(w, h) {
        const ui = window.UiTheme || {};
        const langs = [
            ['zh', '中文'],
            ['en', 'English'],
            ['es', 'Español'],
            ['pt', 'Português']
        ];
        const btnW = 110;
        const btnH = 46;
        const gap = 10;
        const totalW = langs.length * btnW + (langs.length - 1) * gap;
        const cur = I18N.lang();

        this._langRoot = this.add.container(w / 2, h - 56).setDepth(40).setScrollFactor(0);
        this._langBtns = [];

        langs.forEach(([code, name], i) => {
            const x = -totalW / 2 + i * (btnW + gap) + btnW / 2;
            const active = code === cur;
            const gfx = this.add.graphics();
            const paintBtn = (g) => {
                g.clear();
                g.fillStyle(0x14100c, active ? 0.95 : 0.55);
                g.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 12);
                g.lineStyle(2, active ? 0xe0c078 : 0x6b6150, active ? 0.95 : 0.5);
                g.strokeRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 12);
            };
            paintBtn(gfx);
            const txt = this.add.text(0, 0, name, {
                fontFamily: ui.font || '"Microsoft YaHei",sans-serif',
                fontSize: '24px',
                fill: active ? (ui.gold || '#e0c078') : (ui.muted || '#9a8f7e'),
                fontStyle: 'bold'
            }).setOrigin(0.5);
            const hit = this.add.zone(x, 0, btnW + 4, btnH + 4).setInteractive({ useHandCursor: true });
            const btn = { code, gfx, txt, active, paintBtn };
            hit.on('pointerup', () => {
                if (btn.code === I18N.lang()) return;
                I18N.setLang(btn.code);
                this.refreshLangUI();
            });
            this._langRoot.add([gfx, txt, hit]);
            this._langBtns.push(btn);
        });
    }

    refreshLangUI() {
        const cur = I18N.lang();
        const ui = window.UiTheme || {};
        (this._langBtns || []).forEach(btn => {
            btn.active = btn.code === cur;
            btn.paintBtn(btn.gfx);
            btn.txt.setColor(btn.active ? (ui.gold || '#e0c078') : (ui.muted || '#9a8f7e'));
        });
        if (this._btnTxt) this._btnTxt.setText(window.t('title.start', '开始游戏'));
        if (this._titlePlaceholder) this._titlePlaceholder.setText(window.t('title.name', '盗亦有道'));
        if (this._titlePlaceholderSub) this._titlePlaceholderSub.setText(window.t('title.logoPlaceholder', '（此处可换成艺术字贴图）'));
    }

    startGame() {
        if (this._starting) return;
        this._starting = true;
        this.cameras.main.fadeOut(280, 10, 8, 6);
        this.time.delayedCall(300, () => {
            this.scene.start(CONFIG.SCENES.PRELOAD);
        });
    }

    onResize(gameSize) {
        const w = gameSize.width;
        const h = gameSize.height;
        this.cameras.main.setSize(w, h);
        if (this._titleRoot) {
            this._titleRoot.setPosition(w / 2, h * 0.28);
        }
        if (this._btnRoot) {
            this._btnRoot.setPosition(w / 2, h * 0.72);
            // 呼吸 tween 的目标 y 会偏，重启一下太重；只校正 x/基准即可
        }
        if (this._langRoot) {
            this._langRoot.setPosition(w / 2, h - 56);
        }
    }

    update(_t, delta) {
        const h = this.cameras.main.height;
        const dt = (delta || 16) / 1000;
        for (let i = 0; i < this._drops.length; i++) {
            const d = this._drops[i];
            if (!d.spr || !d.spr.active) continue;
            d.spr.y += d.vy * dt;
            d.spr.angle += d.rot * dt;
            if (d.spr.y > h + 60) this.recycleDrop(d);
        }
    }
}
