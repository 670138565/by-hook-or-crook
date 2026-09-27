/* =====================================================================
 * 背包界面场景（BackpackScene.js）
 * =====================================================================
 * 作用：按 Tab 打开的背包界面，叠在主游戏上面（主游戏暂停）。
 *
 * 设计思路（背包英雄风格）：
 *   - 背包是一个网格，每格有"已解锁 / 未解锁"两种状态
 *   - 物品占 w×h 格，放在已解锁的空格里
 *   - 拖动物品放到格子上；按 R 旋转（横竖切换）
 *   - 升级给"扩展点"，玩家自己点未解锁的格子来解锁（只能扩相邻格）
 *
 * 本版功能：
 *   1. 显示背包底图 + 网格（已解锁/未解锁/可扩展）
 *   2. 物品拖放：拖到已解锁空格→放置；放到未解锁/被占/越界→弹回
 *   3. 拖动时按 R 旋转物品（rot 0/1/2/3，宽高互换 + 图片转 90 度，正方形也能转）
 *   4. 放置预览：绿色=可放，红色=不可放
 *   5. 点相邻未解锁格消耗1点扩展点解锁（自定义形状）
 *   6. 物品可暂时放格子外；关闭时掉地上，或正在开容器则进容器
 *   7. 已放置物品占用的格子显示稀有度颜色
 *   8. 单击物品：面包/草药回血并消耗；装备只提示；赃物暂不能卖
 *   9. Tab / Esc 关闭
 * ===================================================================== */
class BackpackScene extends Phaser.Scene {
    constructor() {
        super({ key: CONFIG.SCENES.BACKPACK });
    }

    init(data) {
        // 从容器打开时：左右分栏（左背包、右箱子），格子外物品关闭后进容器
        this.fromContainer = !!(data && data.fromContainer);
        this.containerId = (data && data.containerId) || null;
        this.containerName = (data && data.containerName) || '容器';
        this.lockLevel = (data && data.lockLevel) || 1;
    }

    /**
     * 底图网格换算：1格在原图上等于多少像素
     * cellSize_屏幕 = cellFactor * scale
     */
    cellFactor(gr, cols, rows) {
        return Math.min(gr.w / cols, gr.h / rows);
    }

    /**
     * 按底图 + 网格配置画出外框。
     * 传入 targetCell 时：强制单格像素 = targetCell（开箱分栏时背包/容器格子一样大）
     * 不传时：按 maxW/maxH 等比铺满
     */
    layoutFrame(texKey, gr, cols, rows, cx, cy, maxW, maxH, kind, targetCell) {
        const tex = this.textures.get(texKey).getSourceImage();
        const imgW = tex.width, imgH = tex.height;
        const factor = this.cellFactor(gr, cols, rows);
        const scale = targetCell ? (targetCell / factor) : Math.min(maxW / imgW, maxH / imgH);
        const dispW = imgW * scale, dispH = imgH * scale;
        const offsetX = cx - dispW / 2;
        const offsetY = cy - dispH / 2;
        this.add.image(cx, cy, texKey).setDisplaySize(dispW, dispH).setDepth(1);
        const gridX = offsetX + gr.x * scale;
        const gridY = offsetY + gr.y * scale;
        const gridW = gr.w * scale, gridH = gr.h * scale;
        const cellSize = Math.min(gridW / cols, gridH / rows);
        const blockW = cellSize * cols, blockH = cellSize * rows;
        const startX = gridX + (gridW - blockW) / 2;
        const startY = gridY + (gridH - blockH) / 2;
        return {
            kind, startX, startY, cellSize, cols, rows, blockW, blockH, dispW, dispH,
            allUnlocked: kind === 'chest',
            titleY: offsetY + gr.y * scale * 0.45
        };
    }

    /**
     * 开箱分栏：算出「两边格子一样大」时能放下的最大单格像素
     * 以后铁箱/金箱/其它容器都走这里，不用各调一套缩放
     */
    sharedCellSize(bpKey, bpGr, bpCols, bpRows, chestKey, chestGr, chestCols, chestRows, screenW, screenH) {
        const bp = this.textures.get(bpKey).getSourceImage();
        const ch = this.textures.get(chestKey).getSourceImage();
        const fBp = this.cellFactor(bpGr, bpCols, bpRows);
        const fCh = this.cellFactor(chestGr, chestCols, chestRows);
        const gap = 20;
        const maxW = screenW * 0.98;
        const maxH = screenH * 0.88;
        const sByW = (maxW - gap) / (bp.width / fBp + ch.width / fCh);
        const sByH = Math.min(maxH / (bp.height / fBp), maxH / (ch.height / fCh));
        return Math.min(sByW, sByH);
    }

    create() {
        const cfg = CONFIG.BACKPACK;
        const screenW = this.cameras.main.width;
        const screenH = this.cameras.main.height;
        this.cfg = cfg;

        // ---- 1. 半透明黑色遮罩 ----
        this.add.rectangle(screenW / 2, screenH / 2, screenW, screenH, 0x000000, 0.6).setDepth(0);

        // ---- 2. 背包外框（单独打开铺满；开箱子时左右分栏且单格一样大）----
        if (this.fromContainer) {
            const chestCfg = CONFIG.CHESTS[this.lockLevel] || CONFIG.CHESTS[1];
            this.chestCfg = chestCfg;
            const cell = this.sharedCellSize(
                cfg.BG_KEY, cfg.GRID_RECT, cfg.GRID_COLS, cfg.GRID_ROWS,
                chestCfg.key, chestCfg.GRID_RECT, chestCfg.cols, chestCfg.rows,
                screenW, screenH
            );
            const fBp = this.cellFactor(cfg.GRID_RECT, cfg.GRID_COLS, cfg.GRID_ROWS);
            const fCh = this.cellFactor(chestCfg.GRID_RECT, chestCfg.cols, chestCfg.rows);
            const bpTex = this.textures.get(cfg.BG_KEY).getSourceImage();
            const chTex = this.textures.get(chestCfg.key).getSourceImage();
            const bpW = bpTex.width * (cell / fBp);
            const chW = chTex.width * (cell / fCh);
            const gap = 20;
            const total = bpW + gap + chW;
            const left = (screenW - total) / 2;
            const cy = screenH * 0.48;
            this.bpGrid = this.layoutFrame(
                cfg.BG_KEY, cfg.GRID_RECT, cfg.GRID_COLS, cfg.GRID_ROWS,
                left + bpW / 2, cy, bpW, screenH, 'backpack', cell
            );
            this.chestGrid = this.layoutFrame(
                chestCfg.key, chestCfg.GRID_RECT, chestCfg.cols, chestCfg.rows,
                left + bpW + gap + chW / 2, cy, chW, screenH, 'chest', cell
            );
        } else {
            // 左侧留出属性栏，背包略右移缩小
            const panelW = 220;
            const cx = screenW / 2 + panelW * 0.28;
            this.bpGrid = this.layoutFrame(
                cfg.BG_KEY, cfg.GRID_RECT, cfg.GRID_COLS, cfg.GRID_ROWS,
                cx, screenH / 2, screenW * 0.78, screenH * 0.92, 'backpack'
            );
            this.chestGrid = null;
            this.buildStatsPanel(14, 72);
        }
        this.grid = this.bpGrid; // 扩展格子仍只作用在背包上

        // 画格子
        this.gridGfx = this.add.graphics().setDepth(2);
        this.drawGrid();

        // 放置预览 + 扩展悬停预览
        this.previewGfx = this.add.graphics().setDepth(2.5);
        this.pickZoneGfx = this.add.graphics().setDepth(2.6);
        this.pickZoneText = this.add.text(0, 0, '', {
            fontSize: '20px', color: '#a6e3a1', stroke: '#000000', strokeThickness: 4
        }).setOrigin(0.5).setDepth(12).setVisible(false);

        // 透明点击层：只点背包空格解锁
        const g = this.bpGrid;
        const zone = this.add.rectangle(
            g.startX + g.blockW / 2, g.startY + g.blockH / 2, g.blockW, g.blockH, 0xffffff, 0
        ).setDepth(2.2).setInteractive();
        zone.on('pointerdown', (ptr) => this.onGridClick(ptr));
        zone.on('pointermove', (ptr) => this.onGridHover(ptr));
        zone.on('pointerout', () => this.hoverGfx.clear());
        this.hoverGfx = this.add.graphics().setDepth(2.4);

        // ---- 3. 测试物品：第一次打开且背包为空时塞几个 ----
        if (cfg.SEED_TEST_ITEMS && GameState.get('backpackItems', []).length === 0) {
            const seed = GameState.makeStarterBackpackItems
                ? GameState.makeStarterBackpackItems()
                : [];
            if (seed.length) GameState.set('backpackItems', seed);
        }
        // ---- 4. 箱子物品（开容器时）----
        this.chestItems = [];
        if (this.fromContainer && this.containerId) {
            this.chestItems = GameState.getContainerItems(this.containerId).slice();
        }

        // ---- 5. 创建物品精灵 ----
        this.itemSprites = [];
        GameState.get('backpackItems', []).forEach(it => {
            if (!it.owner) it.owner = 'backpack';
            this.createItemSprite(it);
        });
        this.chestItems.forEach(it => {
            if (!it.owner) it.owner = 'chest';
            this.createItemSprite(it);
        });
        this.drawGrid(); // 物品就位后再刷一遍稀有度色
        this.startChestSearch();

        // ---- 6. 标题 + 底部提示 ----
        this.add.text(this.bpGrid.startX + this.bpGrid.blockW / 2, this.bpGrid.titleY, window.t('bag.title', '背包'), {
            fontSize: this.fromContainer ? '22px' : '32px', color: '#f9e2af', stroke: '#000000', strokeThickness: 4
        }).setOrigin(0.5).setDepth(4);
        if (this.chestGrid) {
            const cname = (this.chestCfg && this.chestCfg.name) || this.containerName;
            this.add.text(this.chestGrid.startX + this.chestGrid.blockW / 2, this.chestGrid.titleY, cname, {
                fontSize: '22px', color: '#f9e2af', stroke: '#000000', strokeThickness: 4
            }).setOrigin(0.5).setDepth(4);
        this._searchStatus = this.add.text(this.chestGrid.startX + this.chestGrid.blockW / 2, this.chestGrid.titleY + 26, '', {
            fontSize: '16px', color: '#a6e3a1', stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(32);
        }
        this.pointsText = this.add.text(screenW / 2, screenH - 48, '', {
            fontSize: '20px', color: '#f9e2af', stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(4);
        this.refreshPointsText();
        const closeHint = this.fromContainer
            ? '开锁器拖到左边松开拿走  ·  其它拖到右边箱子或格子外关闭后进' + this.containerName
            : '格子外的物品关闭时会掉在地上';
        this.add.text(screenW / 2, screenH - 22, '单击使用  ·  拖放  ·  R旋转  ·  ' + closeHint, {
            fontSize: '15px', color: '#a6adc8'
        }).setOrigin(0.5).setDepth(4);

        this.hudRes = this.add.text(16, 16, '', {
            fontSize: '18px',
            color: '#f9e2af',
            backgroundColor: '#00000099',
            padding: { x: 10, y: 6 }
        }).setOrigin(0, 0).setDepth(6).setScrollFactor(0);
        this.refreshHud = () => {
            if (!this.hudRes || !this.hudRes.active) return;
            try { this.hudRes.setText(GameState.hudText()); } catch (e) { /* 纹理竞态防御 */ }
        };
        this.refreshHud();
        this._onHud = () => this.refreshHud();
        // 技能点/属性刷新：合并同帧多次事件并延迟到下一帧执行，
        // 避免场景 restart 后 Phaser Text canvas 纹理未就绪时 setText 崩溃
        this._statsDirty = false;
        this._onStats = () => {
            if (this._statsDirty) return;
            this._statsDirty = true;
            this.time.delayedCall(0, () => {
                this._statsDirty = false;
                if (this.scene.isActive(this.scene.key)) this.refreshStatsPanel();
            });
        };
        EventBus.on('state:金币', this._onHud);
        EventBus.on('state:开锁器', this._onHud);
        EventBus.on('state:生命', this._onHud);
        EventBus.on('state:生命上限', this._onHud);
        EventBus.on('state:等级', this._onHud);
        EventBus.on('state:经验', this._onHud);
        EventBus.on('state:通缉等级', this._onHud);
        EventBus.on('state:技能点', this._onStats);
        EventBus.on('state:属性', this._onStats);
        EventBus.on('state:开锁技能', this._onStats);
        this.events.once('shutdown', () => {
            this.hideItemTip();
            if (this._searchTimer) {
                this._searchTimer.remove(false);
                this._searchTimer = null;
            }
            this.destroyGlass();
            if (this._searchCover) { this._searchCover.destroy(); this._searchCover = null; }
            EventBus.off('state:金币', this._onHud);
            EventBus.off('state:开锁器', this._onHud);
            EventBus.off('state:生命', this._onHud);
            EventBus.off('state:生命上限', this._onHud);
            EventBus.off('state:等级', this._onHud);
            EventBus.off('state:经验', this._onHud);
            EventBus.off('state:通缉等级', this._onHud);
            EventBus.off('state:技能点', this._onStats);
            EventBus.off('state:属性', this._onStats);
            EventBus.off('state:开锁技能', this._onStats);
        });

        this.input.keyboard.on('keydown-TAB', () => this.closeBackpack());
        this.input.keyboard.on('keydown-ESC', () => this.closeBackpack());
        this.input.keyboard.on('keydown-R', () => this.rotateDraggingItem());
        this.dragging = null;
    }

    /** 背包左侧：基础属性 + 装备临时加成 + 技能点加点 */
    buildStatsPanel(x, y) {
        const list = (CONFIG.ATTRS || [
            { key: '开锁', tip: '' },
            { key: '潜行', tip: '' },
            { key: '口才', tip: '' },
            { key: '销赃', tip: '' }
        ]);
        this.statsRoot = this.add.container(x, y).setDepth(8);
        const rowH = 52;
        const maxH = this.cameras.main.height - y - 80;
        const bgH = Math.min(52 + list.length * rowH + 28, maxH);
        const bg = this.add.rectangle(0, 0, 208, bgH, 0x11111b, 0.88)
            .setOrigin(0, 0).setStrokeStyle(2, 0xcba6f7, 0.7);
        this.statsRoot.add(bg);
        this.statsTitle = this.add.text(12, 8, window.t('ui.attrs', '属性'), {
            fontSize: '20px', color: '#f9e2af', stroke: '#000', strokeThickness: 3
        });
        this.statsPointsText = this.add.text(12, 30, window.t('bag.skillPoints', '技能点剩余：{n}', { n: 0 }), {
            fontSize: '15px', color: '#a6e3a1', stroke: '#000', strokeThickness: 2
        });
        this.statsRoot.add([this.statsTitle, this.statsPointsText]);
        this.statsRows = [];
        list.forEach((def, i) => {
            const rowY = 54 + i * rowH;
            if (rowY + 40 > bgH) return;
            const name = this.add.text(12, rowY, window.t('attr.' + def.key, def.key), {
                fontSize: '17px', color: '#cdd6f4', stroke: '#000', strokeThickness: 2
            });
            const val = this.add.text(12, rowY + 20, '基础 -', {
                fontSize: '13px', color: '#a6adc8', stroke: '#000', strokeThickness: 2
            });
            const btn = this.add.text(168, rowY + 6, '+', {
                fontSize: '24px', color: '#1e1e2e', backgroundColor: '#f9e2af',
                padding: { x: 10, y: 1 }
            }).setInteractive({ useHandCursor: true });
            btn.on('pointerdown', () => {
                const r = GameState.spendSkillPoint(def.key);
                if (!r.ok) {
                    this.showHint(r.reason === 'nopoints' ? window.t('bag.noPoints', '没有技能点了') : window.t('bag.cantRaise', '不能加这项'));
                    return;
                }
                this.refreshStatsPanel();
                this.refreshHud();
                this.showHint(window.t('attr.' + def.key, def.key) + ' +1');
            });
            if (def.tip) {
                btn.on('pointerover', () => this.showHint(window.t('attr.' + def.key + '.tip', def.tip)));
            }
            this.statsRoot.add([name, val, btn]);
            this.statsRows.push({ key: def.key, val: val, btn: btn });
        });
        this.refreshStatsPanel();
    }

    /** 安全 setText：Text 可能因场景 restart/销毁而纹理异常，防御性刷新 */
    safeSetText(text, str) {
        if (!text || !text.active || !text.scene) return;
        try {
            text.setText(str);
        } catch (e) { /* Phaser canvas 纹理未就绪时跳过本次刷新，下次事件会再刷 */ }
    }

    refreshStatsPanel() {
        if (!this.statsRows) return;
        const pts = GameState.get('技能点', 0) || 0;
        if (this.statsPointsText) {
            this.safeSetText(this.statsPointsText, window.t('bag.skillPoints', '技能点剩余：{n}', { n: pts }));
            try { this.statsPointsText.setColor(pts > 0 ? '#a6e3a1' : '#6c7086'); } catch (e) { /* 纹理竞态防御 */ }
        }
        const base = GameState.getAttrs ? GameState.getAttrs() : {};
        const worn = GameState.liveOutStats ? GameState.liveOutStats()
            : (GameState.wornOutStats ? GameState.wornOutStats() : {});
        const lockBonus = GameState.lockpickItemBonus ? GameState.lockpickItemBonus() : 0;
        const fencePer = (CONFIG.ATTR_FENCE_PCT != null) ? CONFIG.ATTR_FENCE_PCT : 5;
        const bonusOf = {
            开锁: lockBonus,
            潜行: worn.stealth || 0,
            口才: worn.speech || 0,
            销赃: worn.fence || 0
        };
        this.statsRows.forEach(row => {
            const b = base[row.key] || 0;
            const extra = bonusOf[row.key] || 0;
            let line;
            if (row.key === '销赃') {
                line = extra
                    ? (window.t('bag.base', '基础') + ' ' + b + window.t('bag.fenceNote', '（约 +{n}%）', { n: b * fencePer }) + '  ' + window.t('bag.equipBonus', '装备 +{n}', { n: extra }) + '%')
                    : (window.t('bag.base', '基础') + ' ' + b + (b ? window.t('bag.fenceNote', '（约 +{n}%）', { n: b * fencePer }) : ''));
            } else {
                const total = b + extra;
                line = extra
                    ? (window.t('bag.base', '基础') + ' ' + b + '  ' + window.t('bag.equipBonus', '装备 +{n}', { n: extra }) + '  → ' + total)
                    : (window.t('bag.base', '基础') + ' ' + b + '  → ' + total);
            }
            this.safeSetText(row.val, line);
            if (row.btn) row.btn.setAlpha(pts > 0 ? 1 : 0.35);
        });
    }

    /** 画一侧网格：背包有解锁/扩展；箱子整格已开 */
    drawOneGrid(grid, items) {
        if (!grid) return;
        const g = this.gridGfx;
        const { startX, startY, cellSize, cols, rows } = grid;
        const canExpand = this.canExpandGrid();
        const hasPts = canExpand && !grid.allUnlocked && GameState.get('backpackExpandPoints', 0) > 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = startX + c * cellSize, y = startY + r * cellSize;
                const unlocked = grid.allUnlocked || GameState.isCellUnlocked(c, r);
                if (unlocked) {
                    g.fillStyle(0x2b2b2b, 0.85).fillRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
                    g.lineStyle(2, 0xcba6f7, 0.6).strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
                } else if (hasPts && GameState.isAdjacentToUnlocked(c, r)) {
                    g.fillStyle(0x3d2e10, 0.85).fillRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
                    g.lineStyle(2, 0xf9e2af, 0.9).strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
                } else {
                    g.fillStyle(0x1a1a1a, 0.85).fillRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
                    g.lineStyle(2, 0x45475a, 0.8).strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
                }
            }
        }
        const colors = CONFIG.BACKPACK.RARITY_COLORS || {};
        items.forEach(it => {
            if (!GameState.isItemPlaced(it)) return;
            if ((it.owner || 'backpack') !== grid.kind) return;
            const hidden = this.needsSearch(it);
            const color = hidden ? 0x6c7086 : (colors[it.rarity] || colors.common || 0xa6e3a1);
            ItemDB.cellsOf(it).forEach(p => {
                const x = startX + (it.col + p.c) * cellSize;
                const y = startY + (it.row + p.r) * cellSize;
                g.fillStyle(color, 0.38).fillRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
                g.lineStyle(2, color, 0.95).strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
            });
        });
    }

    /** 重画背包 + 箱子两套格子 */
    drawGrid() {
        this.gridGfx.clear();
        const all = GameState.get('backpackItems', []).concat(this.chestItems || []);
        this.drawOneGrid(this.bpGrid, all);
        this.drawOneGrid(this.chestGrid, all);
        this.drawSearchCovers();
    }

    /** 没搜过的格子整块铺实心灰，盖住贴图，看不出里面是什么 */
    drawSearchCovers() {
        if (!this._searchCover) this._searchCover = this.add.graphics().setDepth(8);
        const g = this._searchCover;
        g.clear();
        if (!this.fromContainer || !this.chestGrid) return;
        const grid = this.chestGrid;
        (this.chestItems || []).forEach(it => {
            if (!this.needsSearch(it)) return;
            ItemDB.cellsOf(it).forEach(p => {
                const x = grid.startX + (it.col + p.c) * grid.cellSize;
                const y = grid.startY + (it.row + p.r) * grid.cellSize;
                const s = grid.cellSize;
                g.fillStyle(0x5a5a5a, 1);
                g.fillRect(x, y, s, s);
                g.lineStyle(2, 0x3d3d3d, 1);
                g.strokeRect(x + 1, y + 1, s - 2, s - 2);
            });
        });
    }

    /** 物品当前该用哪套格子的尺寸 */
    gridFor(it) {
        if (it && it.owner === 'chest' && this.chestGrid) return this.chestGrid;
        return this.bpGrid;
    }

    /** 只有单独开背包（不是开箱子）才能看金色格、点格子扩展 */
    canExpandGrid() {
        return !this.fromContainer;
    }

    /** 刷新底部扩展点文字 */
    refreshPointsText() {
        if (!this.canExpandGrid()) {
            this.safeSetText(this.pointsText, '');
            return;
        }
        const n = GameState.get('backpackExpandPoints', 0);
        this.safeSetText(this.pointsText, n > 0 ? '扩展点：' + n + '  （点金色格子解锁）' : '扩展点：0');
    }

    /** 鼠标坐标转格子 col/row，出界返回 null */
    pointerToCell(ptr) {
        const { startX, startY, cellSize, cols, rows } = this.grid;
        const col = Math.floor((ptr.x - startX) / cellSize);
        const row = Math.floor((ptr.y - startY) / cellSize);
        if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
        return { col, row };
    }

    /** 点空格子：尝试解锁 */
    onGridClick(ptr) {
        if (this.dragging || !this.canExpandGrid()) return;
        const cell = this.pointerToCell(ptr);
        if (!cell) return;
        const { cols, rows } = this.grid;
        const result = GameState.tryUnlockCell(cell.col, cell.row, cols, rows);
        if (result.ok) {
            this.drawGrid();
            this.refreshPointsText();
            this.hoverGfx.clear();
            return;
        }
        if (result.reason === 'nopoints') this.showHint('没有扩展点了');
        else if (result.reason === 'notadj') this.showHint('只能解锁与已解锁格子相邻的格子');
    }

    /** 鼠标悬停可扩展格时画金色高亮 */
    onGridHover(ptr) {
        if (this.dragging || !this.canExpandGrid()) {
            this.hoverGfx.clear();
            return;
        }
        this.hoverGfx.clear();
        const cell = this.pointerToCell(ptr);
        if (!cell) return;
        if (GameState.isCellUnlocked(cell.col, cell.row)) return;
        const can = GameState.get('backpackExpandPoints', 0) > 0
            && GameState.isAdjacentToUnlocked(cell.col, cell.row);
        const { startX, startY, cellSize } = this.grid;
        const x = startX + cell.col * cellSize, y = startY + cell.row * cellSize;
        this.hoverGfx.fillStyle(can ? 0xf9e2af : 0xff0000, 0.25).fillRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
        this.hoverGfx.lineStyle(2, can ? 0xf9e2af : 0xff0000, 0.9).strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
    }

    /** 背包界面底部短暂提示 */
    showHint(msg) {
        if (this.hintText) this.hintText.destroy();
        this.hintText = this.add.text(this.cameras.main.width / 2, this.cameras.main.height - 72, msg, {
            fontSize: '18px', color: '#f38ba8', stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(5);
        this.time.delayedCall(1400, () => {
            if (this.hintText) { this.hintText.destroy(); this.hintText = null; }
        });
    }

    /** 计算物品当前占几格（rot 奇数次时宽高互换）。只用来摆位置，不拿来拉伸贴图 */
    footprint(it) {
        return (it.rot % 2 === 1) ? { dw: it.h, dh: it.w } : { dw: it.w, dh: it.h };
    }

    /** 贴图按原图比例塞进占格，再靠旋转摆正，不拉扁 */
    artSize(it, cellSize) {
        const t = ItemDB.texSize(this, it);
        return ItemDB.fitArt(it, cellSize, t.w, t.h, 6);
    }

    bounceItem(it, sprite) {
        if (!sprite || !sprite.active) {
            const entry = this.findEntry(it);
            sprite = entry && entry.sprite;
        }
        if (!sprite || !sprite.active) return;
        const art = this.artSize(it, this.gridFor(it).cellSize);
        this.tweens.killTweensOf(sprite);
        sprite.setDisplaySize(art.w, art.h);
        this.tweens.add({
            targets: sprite,
            displayWidth: art.w * 1.14,
            displayHeight: art.h * 1.14,
            duration: 80,
            yoyo: true,
            onComplete: () => {
                if (sprite.active) sprite.setDisplaySize(art.w, art.h);
            }
        });
    }

    /** 取物品稀有度颜色（和格子颜色同一套） */
    rarityColor(it) {
        const colors = CONFIG.BACKPACK.RARITY_COLORS || {};
        return colors[it.rarity] || colors.common || 0xa6e3a1;
    }

    findEntry(it) {
        return this.itemSprites.find(s => s.data === it);
    }

    /** 格子外：稀有度发光 +「未放入」字 + 轻微闪 */
    applyLooseFx(entry) {
        if (!entry) return;
        this.clearLooseFx(entry);
        const color = this.rarityColor(entry.data);
        if (entry.sprite.postFX) {
            entry.sprite.postFX.clear();
            entry.sprite.postFX.addGlow(color, 8, 0, false);
        }
        const tagY = entry.sprite.y - entry.sprite.displayHeight / 2 - 10;
        const hex = '#' + color.toString(16).padStart(6, '0');
        entry.tag = this.add.text(entry.sprite.x, tagY, '未放入', {
            fontSize: '14px', color: hex, stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(11);
        entry.pulse = this.tweens.add({
            targets: [entry.sprite, entry.tag],
            alpha: { from: 1, to: 0.62 },
            duration: 520,
            yoyo: true,
            repeat: -1
        });
    }

    /** 可穿戴物在背包格子里：角上标「穿」 */
    refreshWornTag(entry) {
        if (!entry) return;
        if (entry.wornTag) { entry.wornTag.destroy(); entry.wornTag = null; }
        if (!GameState.isWorn(entry.data)) return;
        const { dw, dh } = this.footprint(entry.data);
        const cell = this.gridFor(entry.data).cellSize;
        entry.wornTag = this.add.text(
            entry.sprite.x + (dw * cell) / 2 - 8,
            entry.sprite.y - (dh * cell) / 2 + 6,
            '穿',
            { fontSize: '12px', color: '#a6e3a1', stroke: '#000000', strokeThickness: 3 }
        ).setOrigin(1, 0).setDepth(6);
    }

    /** 放进格子后：关掉发光和字 */
    clearLooseFx(entry) {
        if (!entry) return;
        if (entry.pulse) { entry.pulse.stop(); entry.pulse = null; }
        entry.sprite.setAlpha(1);
        if (entry.sprite.postFX) entry.sprite.postFX.clear();
        if (entry.tag) { entry.tag.destroy(); entry.tag = null; }
    }

    /** 拖动时让「未放入」跟着物品走 */
    syncLooseTag(entry) {
        if (!entry || !entry.tag) return;
        entry.tag.x = entry.sprite.x;
        entry.tag.y = entry.sprite.y - entry.sprite.displayHeight / 2 - 10;
    }

    /** 箱子里还没搜过的物品：灰色，不能拿 */
    needsSearch(it) {
        return !!(this.fromContainer && it && (it.owner || '') === 'chest'
            && GameState.isItemPlaced(it) && !it.searched);
    }

    searchMs(it) {
        const q = (window.ItemDB && ItemDB.qualityOf) ? ItemDB.qualityOf(it) : 1;
        return Math.max(1, Math.min(5, q || 1)) * 1000;
    }

    applySearchLook(it, sprite) {
        if (!sprite) return;
        if (this.needsSearch(it)) {
            sprite.setVisible(false);
            sprite.disableInteractive();
        }
    }

    ensureGlass() {
        if (this._glass && this._glass.scene && this._glass.active) return this._glass;
        this.destroyGlass();

        const g = this.add.graphics();
        g.lineStyle(3, 0xfff8e7, 1);
        g.strokeCircle(-6, -8, 14);
        g.fillStyle(0xd6c7f7, 0.45);
        g.fillCircle(-6, -8, 13);
        g.lineStyle(5, 0xf9e2af, 1);
        g.lineBetween(4, 2, 16, 16);
        // 盖在搜索灰盖（depth 8）和物品上面
        this._glass = this.add.container(0, 0, [g]).setDepth(30).setVisible(false);
        this._glassCx = 0;
        this._glassCy = 0;
        this._glassR = 22;
        this._glassSpin = { a: 0 };
        this._glassSpinTween = this.tweens.add({
            targets: this._glassSpin,
            a: Math.PI * 2,
            duration: 1100,
            repeat: -1,
            ease: 'Linear',
            onUpdate: () => {
                if (!this._glass || !this._glass.visible || !this._glass.active) return;
                const a = this._glassSpin.a;
                this._glass.x = this._glassCx + Math.cos(a) * this._glassR;
                this._glass.y = this._glassCy + Math.sin(a) * this._glassR;
            }
        });
        return this._glass;
    }

    destroyGlass() {
        if (this._glassSpinTween) {
            this._glassSpinTween.stop();
            this._glassSpinTween.remove();
            this._glassSpinTween = null;
        }
        if (this._glass) {
            this._glass.destroy(true);
            this._glass = null;
        }
        this._glassSpin = null;
    }

    showGlass(it, sprite) {
        const glass = this.ensureGlass();
        if (!glass || !this._glassSpin) return;
        const grid = this.gridFor(it);
        const fp = this.footprint(it);
        const cell = grid.cellSize;
        let cx;
        let cy;
        if (sprite && sprite.active) {
            cx = sprite.x;
            cy = sprite.y;
        } else if (GameState.isItemPlaced(it)) {
            cx = grid.startX + it.col * cell + (fp.dw * cell) / 2;
            cy = grid.startY + it.row * cell + (fp.dh * cell) / 2;
        } else {
            return;
        }
        this._glassCx = cx;
        this._glassCy = cy;
        this._glassR = Math.max(16, Math.min(fp.dw, fp.dh) * cell * 0.34);
        this._glassSpin.a = 0;
        glass.setAngle(0);
        glass.setPosition(cx + this._glassR, cy);
        glass.setVisible(true);
        glass.setActive(true);
        glass.setDepth(30);
    }

    hideGlass() {
        if (this._glass && this._glass.active) this._glass.setVisible(false);
    }

    revealSearched(it) {
        if (!it) return;
        it.searched = true;
        this.updateSearchStatus(it.name || (ItemDB && ItemDB.displayName ? ItemDB.displayName(it) : ''));
        const entry = this.findEntry(it);
        const sprite = entry && entry.sprite;
        if (sprite && sprite.active) {
            sprite.setVisible(true);
            sprite.clearTint();
            if (window.ItemDB && ItemDB.tintPoisoned) ItemDB.tintPoisoned(sprite, it);
            sprite.setInteractive({ draggable: true, useHandCursor: true });
            this.input.setDraggable(sprite);
        }
        this.drawGrid();
        if (window.GameState && GameState.gainXp && GameState.searchXpFor) {
            const xp = GameState.searchXpFor(it);
            if (xp > 0) {
                const grew = GameState.gainXp(xp);
                let tip = window.t('bag.gotLoot', '搜到物品  经验 +{n}', { n: grew.xp });
                if (grew.levels && grew.levels.length) tip += '  升级！';
                this.showHint(tip);
            }
        }
        if (this.refreshHud) this.refreshHud();
    }

    startChestSearch() {
        if (!this.fromContainer) return;
        const list = (this.chestItems || []).filter(it => this.needsSearch(it));
        list.sort((a, b) => (a.row - b.row) || (a.col - b.col));
        this._searchQueue = list;
        this._searchIdx = 0;
        this.updateSearchStatus();
        // 等一帧，确保格子盖子和精灵都落位后再转圈
        this.time.delayedCall(30, () => this.searchNext());
    }

    /** 搜索进度文字：让玩家知道搜到第几件，避免长搜索看起来像卡死 */
    updateSearchStatus(doneName) {
        if (!this._searchStatus) return;
        const q = this._searchQueue || [];
        const n = q.length;
        if (!this.fromContainer || n === 0) { this.safeSetText(this._searchStatus, ''); return; }
        const done = Math.max(0, Math.min(this._searchIdx || 0, n));
        if (doneName) {
            this.safeSetText(this._searchStatus, '搜到：' + doneName + '（' + done + '/' + n + '）');
        } else {
            this.safeSetText(this._searchStatus, '正在搜索 ' + (done + 1) + ' / ' + n + '  ···');
        }
    }

    searchNext() {
        const q = this._searchQueue || [];
        while (this._searchIdx < q.length && !this.needsSearch(q[this._searchIdx])) this._searchIdx++;
        const it = q[this._searchIdx];
        if (!it) {
            this.hideGlass();
            if (this._searchStatus) {
                this.safeSetText(this._searchStatus, q.length ? '全部搜完，可以拿了' : '');
            }
            return;
        }
        const entry = this.findEntry(it);
        const sprite = entry && entry.sprite;
        // 没有精灵也按格子坐标转圈，不再直接跳过（否则放大镜偶发不出现）
        this.showGlass(it, sprite);
        this.updateSearchStatus();
        if (this._searchTimer) this._searchTimer.remove(false);
        this._searchTimer = this.time.delayedCall(this.searchMs(it), () => {
            this._searchTimer = null;
            this.revealSearched(it);
            this._searchIdx++;
            this.searchNext();
        });
    }

    /** 为一个物品数据创建精灵，并绑定拖动 / 单击使用 */
    createItemSprite(it) {
        const grid = this.gridFor(it);
        const { startX, startY, cellSize } = grid;
        const { dw, dh } = this.footprint(it);
        const pxW = dw * cellSize, pxH = dh * cellSize;
        let cx, cy;
        if (GameState.isItemPlaced(it)) {
            cx = startX + it.col * cellSize + pxW / 2;
            cy = startY + it.row * cellSize + pxH / 2;
        } else {
            cx = startX + (it.looseOX != null ? it.looseOX : 80);
            cy = startY + (it.looseOY != null ? it.looseOY : -70);
        }

        const art = this.artSize(it, cellSize);
        const key = (it.image && this.textures.exists('item:' + it.image))
            ? ('item:' + it.image)
            : 'item:missing';
        const sprite = this.add.image(cx, cy, key).setDisplaySize(art.w, art.h).setDepth(3);
        sprite.setAngle((it.rot || 0) * 90);
        if (window.ItemDB && ItemDB.tintPoisoned) ItemDB.tintPoisoned(sprite, it);
        sprite.setInteractive({ draggable: true, useHandCursor: true });
        this.input.setDraggable(sprite);
        this.applySearchLook(it, sprite);

        // 记录按下位置：移动很小算单击使用，移动大了才是拖放
        sprite.on('pointerdown', (ptr) => {
            this._press = { x: ptr.x, y: ptr.y };
        });

        sprite.on('dragstart', () => {
            this.hideItemTip();
            if (this.needsSearch(it)) {
                this.dragging = null;
                return;
            }
            sprite.setDepth(10);
            this.dragging = {
                data: it, sprite: sprite,
                fromCol: it.col, fromRow: it.row, fromRot: it.rot,
                fromPlaced: GameState.isItemPlaced(it),
                fromOwner: it.owner || 'backpack',
                fromOX: it.looseOX, fromOY: it.looseOY
            };
            this.updatePreview();
        });

        sprite.on('drag', (pointer) => {
            sprite.x = pointer.x;
            sprite.y = pointer.y;
            this.syncLooseTag(this.findEntry(it));
            this.updatePreview();
        });

        sprite.on('dragend', (pointer) => {
            if (this.tryCollectLockpick(pointer)) {
                this.previewGfx.clear();
                this.clearLockpickZone();
                this.dragging = null;
                return;
            }
            if (this.tryPoisonOnFood(pointer)) {
                this.previewGfx.clear();
                this.clearLockpickZone();
                this.dragging = null;
                return;
            }
            const placed = this.tryPlace();
            if (!placed) {
                if (window.ItemDB && ItemDB.isLockpickResource(it)) this.restoreDrag();
                else this.leaveOutside();
            }
            sprite.setDepth(3);
            this.previewGfx.clear();
            this.clearLockpickZone();
            this.dragging = null;
        });

        sprite.on('pointerup', (ptr) => {
            if (this.dragging || !this._press) return; // 正在拖就不算单击
            const dist = Math.hypot(ptr.x - this._press.x, ptr.y - this._press.y);
            this._press = null;
            if (dist < 8) this.useItem(it, sprite); // 几乎没移动 = 单击使用
        });

        sprite.on('pointerover', (ptr) => {
            if (this.dragging) return;
            this.showItemTip(it, ptr);
        });
        sprite.on('pointermove', (ptr) => {
            if (this.dragging) { this.hideItemTip(); return; }
            this.moveItemTip(ptr);
        });
        sprite.on('pointerout', () => this.hideItemTip());

        const entry = { data: it, sprite: sprite, tag: null, pulse: null };
        this.itemSprites.push(entry);
        if (!GameState.isItemPlaced(it)) this.applyLooseFx(entry);
        else this.refreshWornTag(entry);
    }

    /** 计算拖动中物品想放到哪一侧、哪一格；指针不在任何网格上则返回 null */
    getDropCell() {
        if (!this.dragging) return null;
        const it = this.dragging.data;
        const { dw, dh } = this.footprint(it);
        const ptr = this.input.activePointer;
        const grids = this.chestGrid ? [this.chestGrid, this.bpGrid] : [this.bpGrid];
        let grid = null;
        for (let i = 0; i < grids.length; i++) {
            const g = grids[i];
            if (ptr.x >= g.startX && ptr.x <= g.startX + g.blockW &&
                ptr.y >= g.startY && ptr.y <= g.startY + g.blockH) {
                grid = g;
                break;
            }
        }
        if (!grid) return null;
        const col = Math.round((ptr.x - (dw * grid.cellSize) / 2 - grid.startX) / grid.cellSize);
        const row = Math.round((ptr.y - (dh * grid.cellSize) / 2 - grid.startY) / grid.cellSize);
        return { grid, col, row, dw, dh };
    }

    lockpickLeftBound() {
        return this.chestGrid ? this.chestGrid.startX : (this.cameras.main.width / 2);
    }

    clearLockpickZone() {
        if (this.pickZoneGfx) this.pickZoneGfx.clear();
        if (this.pickZoneText) this.pickZoneText.setVisible(false);
    }

    drawLockpickZone() {
        this.clearLockpickZone();
        const d = this.dragging;
        if (!d || !window.ItemDB || !ItemDB.isLockpickResource(d.data)) return;
        const leftBound = this.lockpickLeftBound();
        const H = this.cameras.main.height;
        const n = ItemDB.lockpickAmount(d.data) || 1;
        const over = this.input.activePointer.x < leftBound;
        this.pickZoneGfx.fillStyle(over ? 0xa6e3a1 : 0xf9e2af, over ? 0.2 : 0.08);
        this.pickZoneGfx.fillRect(0, 0, leftBound, H);
        this.pickZoneGfx.lineStyle(2, over ? 0xa6e3a1 : 0xf9e2af, 0.75);
        this.pickZoneGfx.strokeRect(6, 6, Math.max(8, leftBound - 12), H - 12);
        this.pickZoneText.setPosition(leftBound / 2, H * 0.46);
        try { this.pickZoneText.setColor(over ? '#a6e3a1' : '#f9e2af'); } catch (e) { /* 纹理竞态防御 */ }
        this.safeSetText(this.pickZoneText, over ? ('松开：开锁器 +' + n) : '拖到这里松开拿走');
        this.pickZoneText.setVisible(true);
    }

    /** 开锁器拖到箱子左边松开：收入数字，物品消失，原地浮字 */
    tryCollectLockpick(pointer) {
        const d = this.dragging;
        if (!d || !window.ItemDB || !ItemDB.isLockpickResource(d.data)) return false;
        const x = pointer && pointer.x != null ? pointer.x : this.input.activePointer.x;
        if (x >= this.lockpickLeftBound()) return false;
        const n = ItemDB.lockpickAmount(d.data) || 1;
        const sx = d.sprite.x, sy = d.sprite.y;
        GameState.gainLockpicks(n);
        this.removeUsedItem(d.data);
        if (this.fromContainer && this.containerId) {
            GameState.setContainerItems(this.containerId, this.containerName, this.chestItems);
        }
        this.showFloatHint(sx, sy, '开锁器+' + n);
        return true;
    }

    showFloatHint(x, y, msg) {
        const t = this.add.text(x, y, msg, {
            fontSize: '22px',
            color: '#a6e3a1',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5).setDepth(20);
        this.tweens.add({
            targets: t,
            y: y - 46,
            alpha: 0,
            duration: 900,
            ease: 'Cubic.easeOut',
            onComplete: () => { if (t.active) t.destroy(); }
        });
    }

    restoreDrag() {
        const d = this.dragging;
        if (!d) return;
        const it = d.data;
        it.col = d.fromCol;
        it.row = d.fromRow;
        it.rot = d.fromRot;
        it.placed = d.fromPlaced;
        it.owner = d.fromOwner;
        it.looseOX = d.fromOX;
        it.looseOY = d.fromOY;
        this.snapTo(it);
    }

    canPlace(grid, col, row, it, ignoreId) {
        if (!grid || !it) return false;
        if (window.ItemDB && ItemDB.isLockpickResource(it) && grid.kind === 'backpack') return false;
        const cells = ItemDB.cellsOf(it);
        if (!cells.length) return false;
        const occupied = new Set();
        const all = GameState.get('backpackItems', []).concat(this.chestItems || []);
        all.forEach(o => {
            if (o.id === ignoreId) return;
            if (!GameState.isItemPlaced(o)) return;
            if ((o.owner || 'backpack') !== grid.kind) return;
            ItemDB.cellsOf(o).forEach(p => occupied.add((o.col + p.c) + ',' + (o.row + p.r)));
        });
        for (let i = 0; i < cells.length; i++) {
            const c = col + cells[i].c, r = row + cells[i].r;
            if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return false;
            if (!grid.allUnlocked && !GameState.isCellUnlocked(c, r)) return false;
            if (occupied.has(c + ',' + r)) return false;
        }
        return true;
    }

    /** 拖动中实时画放置预览：绿=可放，红=不可放 */
    updatePreview() {
        const g = this.previewGfx;
        g.clear();
        this.drawLockpickZone();
        const drop = this.getDropCell();
        if (!drop) return;
        if (window.ItemDB && ItemDB.isLockpickResource(this.dragging.data) && drop.grid.kind !== 'chest') return;
        const { startX, startY, cellSize } = drop.grid;
        const ok = this.canPlace(drop.grid, drop.col, drop.row, this.dragging.data, this.dragging.data.id);
        const color = ok ? 0x00ff00 : 0xff0000;
        ItemDB.cellsOf(this.dragging.data).forEach(p => {
            const x = startX + (drop.col + p.c) * cellSize;
            const y = startY + (drop.row + p.r) * cellSize;
            g.fillStyle(color, 0.3).fillRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
            g.lineStyle(3, color, 0.9).strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
        });
    }

    /** 拖动结束尝试放置：合法则更新数据并吸附到格子，返回 true */
    tryPlace() {
        const drop = this.getDropCell();
        if (!drop) return false;
        const it = this.dragging.data;
        if (!this.canPlace(drop.grid, drop.col, drop.row, it, it.id)) return false;
        it.col = drop.col;
        it.row = drop.row;
        it.placed = true;
        it.owner = drop.grid.kind;
        if (drop.grid.kind === 'chest' && this.dragging.fromOwner !== 'chest') it.searched = true;
        // 新手教程：从箱子拖进背包格 = 完成拖入教学
        if (drop.grid.kind === 'backpack' && this.dragging.fromOwner === 'chest' && window.TutSys) {
            TutSys.notify('itemToBackpack');
        }
        this.snapTo(it);
        const entry = this.findEntry(it);
        this.clearLooseFx(entry);
        this.refreshWornTag(entry);
        this.drawGrid();
        this.bounceItem(it, this.dragging && this.dragging.sprite);
        return true;
    }

    /** 把物品精灵吸附到它数据里的 col/row 位置 */
    snapTo(it) {
        const { startX, startY, cellSize } = this.gridFor(it);
        const { dw, dh } = this.footprint(it);
        const pxW = dw * cellSize, pxH = dh * cellSize;
        const sprite = this.dragging ? this.dragging.sprite : this.itemSprites.find(s => s.data === it).sprite;
        if (GameState.isItemPlaced(it)) {
            sprite.x = startX + it.col * cellSize + pxW / 2;
            sprite.y = startY + it.row * cellSize + pxH / 2;
        } else {
            sprite.x = startX + (it.looseOX || 0);
            sprite.y = startY + (it.looseOY || 0);
        }
        const art = this.artSize(it, cellSize);
        sprite.setDisplaySize(art.w, art.h);
        sprite.setAngle((it.rot || 0) * 90);
    }

    /** 放不进格子：留在当前鼠标位置（格子外） */
    leaveOutside() {
        const it = this.dragging.data;
        const sprite = this.dragging.sprite;
        it.placed = false;
        it.col = -1;
        it.row = -1;
        it.owner = 'loose';
        it.looseOX = sprite.x - this.bpGrid.startX;
        it.looseOY = sprite.y - this.bpGrid.startY;
        const entry = this.findEntry(it);
        if (entry && entry.wornTag) { entry.wornTag.destroy(); entry.wornTag = null; }
        this.applyLooseFx(entry);
        this.drawGrid();
    }

    itemLabel(it) {
        return (window.ItemDB && ItemDB.displayName) ? ItemDB.displayName(it) : ((it && it.name) || '物品');
    }

    tryPoisonOnFood(pointer) {
        const d = this.dragging;
        if (!d || !window.ItemDB || !ItemDB.isPoisonVial(d.data)) return false;
        const px = pointer && pointer.x != null ? pointer.x : this.input.activePointer.x;
        const py = pointer && pointer.y != null ? pointer.y : this.input.activePointer.y;
        let hit = null;
        for (let i = 0; i < this.itemSprites.length; i++) {
            const e = this.itemSprites[i];
            if (!e || e.data === d.data || !e.sprite) continue;
            if (!ItemDB.isFood(e.data)) continue;
            const b = e.sprite.getBounds();
            if (px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height) {
                hit = e;
                break;
            }
        }
        if (!hit) return false;
        if (hit.data.poisoned) {
            this.restoreDrag();
            this.showHint('已经下过毒了');
            return true;
        }
        hit.data.poisoned = true;
        if (ItemDB.tintPoisoned) ItemDB.tintPoisoned(hit.sprite, hit.data);
        const name = this.itemLabel(hit.data);
        this.removeUsedItem(d.data);
        this.bounceItem(hit.data, hit.sprite);
        this.showHint('下毒成功：' + name);
        this.showFloatHint(hit.sprite.x, hit.sprite.y, '有毒');
        return true;
    }

    /** 单击使用：回血等会消耗物品；装备只提示 */
    useItem(it, sprite) {
        const label = this.itemLabel(it);
        if (ItemDB.isWearable(it)) {
            this.bounceItem(it, sprite);
            this.showHint(GameState.isWorn(it)
                ? (label + '已穿上（放在背包格子里就算装备）')
                : ('把' + label + '放进背包格子即视为穿上'));
            return;
        }
        if (ItemDB.isPoisonVial && ItemDB.isPoisonVial(it)) {
            this.bounceItem(it, sprite);
            this.showHint(label + '：拖到食物上可以下毒；战斗里点一下给下次攻击上毒');
            return;
        }
        if (ItemDB.combatCat(it) === 'potion') {
            this.bounceItem(it, sprite);
            this.showHint(label + '：战斗里喝，不耗能量，用完消失');
            return;
        }
        if (ItemDB.isCombatConsumable(it)) {
            this.bounceItem(it, sprite);
            this.showHint(label + '：战斗里点一下就扔出去，不耗能量，用完消失');
            return;
        }
        if (ItemDB.lockKeyOf && ItemDB.lockKeyOf(it)) {
            this.bounceItem(it, sprite);
            this.showHint(label + '：放进格子，开箱子时点下面的钥匙用，用一次少一把');
            return;
        }
        const effect = ItemDB.effectOf(it);
        if (!effect || !effect.type) {
            this.bounceItem(it, sprite);
            this.showHint(label + '：现在还不能用');
            return;
        }
        if (effect.type === 'heal') {
            if (it.poisoned) {
                this.bounceItem(it, sprite);
                this.showHint(label + '有毒，别自己吃');
                return;
            }
            const r = GameState.heal(effect.value);
            if (r.gained <= 0) {
                this.bounceItem(it, sprite);
                this.showHint('生命已满，先不用了');
                return;
            }
            this.removeUsedItem(it);
            if (window.AudioSys) AudioSys.sfx(this, 'sfx_eat');
            this.showHint(label + '：生命 +' + r.gained + '（' + r.after + '/' + r.max + '）');
            return;
        }
        if (effect.type === 'add_lockpick') {
            this.bounceItem(it, sprite);
            this.showHint('把开锁器拖到左边松开，才能拿走');
            return;
        }
        this.bounceItem(it, sprite);
        if (effect.type === 'sell') {
            this.showHint('去摊位才能卖');
            return;
        }
        if (effect.type === 'key' || effect.type === 'quest') {
            this.showHint(label + '：先收着，后面会用到');
            return;
        }
        this.showHint(label + '：现在还不能用');
    }

    /** 用掉一件：从背包/箱子列表和画面上删掉 */
    removeUsedItem(it) {
        const entry = this.findEntry(it);
        GameState.set('backpackItems', (GameState.get('backpackItems') || []).filter(function (x) { return x !== it; }));
        this.chestItems = (this.chestItems || []).filter(function (x) { return x !== it; });
        if (entry) {
            this.itemSprites = this.itemSprites.filter(function (e) { return e !== entry; });
            if (entry.pulse) entry.pulse.stop();
            if (entry.sprite) {
                this.tweens.killTweensOf(entry.sprite);
                entry.sprite.destroy();
            }
            if (entry.tag) entry.tag.destroy();
            if (entry.wornTag) entry.wornTag.destroy();
        }
        this.drawGrid();
    }

    showItemTip(it, ptr) {
        this.hideItemTip();
        if (!it || this.dragging) return;
        let text = '……';
        if (this.needsSearch(it)) {
            text = '未搜过\n还看不清是什么';
        } else if (window.ItemDB && ItemDB.tooltipText) {
            text = ItemDB.tooltipText(it);
        } else {
            text = (it.name || '物品') + (it.desc ? ('\n' + it.desc) : '');
        }
        this._itemTip = this.add.text(0, 0, text, {
            fontFamily: '"Microsoft YaHei","微软雅黑",sans-serif',
            fontSize: '14px',
            color: '#cdd6f4',
            backgroundColor: '#11111be6',
            padding: { x: 10, y: 8 },
            wordWrap: { width: 300 },
            lineSpacing: 5
        }).setOrigin(0, 0).setDepth(60).setScrollFactor(0);
        this.moveItemTip(ptr || this.input.activePointer);
    }

    moveItemTip(ptr) {
        if (!this._itemTip || !ptr) return;
        const cam = this.cameras.main;
        const pad = 10;
        let x = ptr.x + 16;
        let y = ptr.y + 16;
        const tw = this._itemTip.width || 0;
        const th = this._itemTip.height || 0;
        if (x + tw > cam.width - pad) x = ptr.x - tw - 16;
        if (y + th > cam.height - pad) y = cam.height - th - pad;
        if (x < pad) x = pad;
        if (y < pad) y = pad;
        this._itemTip.setPosition(x, y);
    }

    hideItemTip() {
        if (this._itemTip) {
            this._itemTip.destroy();
            this._itemTip = null;
        }
    }

    /** 拖动中按 R 旋转：rot+1（0→1→2→3→0），更新精灵尺寸/角度和预览 */
    rotateDraggingItem() {
        if (!this.dragging) return;
        const it = this.dragging.data;
        it.rot = (it.rot + 1) % 4;
        const drop = this.getDropCell();
        const cellSize = (drop && drop.grid.cellSize) || this.gridFor(it).cellSize;
        const art = this.artSize(it, cellSize);
        this.dragging.sprite.setDisplaySize(art.w, art.h);
        this.dragging.sprite.setAngle(it.rot * 90);
        this.syncLooseTag(this.findEntry(it));
        this.updatePreview();
    }

    /** 关闭：背包格留下、箱子格写回容器、格子外按规则掉地上或进容器 */
    closeBackpack() {
        // 关闭背包音效
        if (window.AudioSys) AudioSys.sfx(this, 'sfx_close_inventory');
        this.hideItemTip();
        const kept = [];
        const chest = [];
        const leftover = [];
        const seen = {};
        const collect = (it) => {
            if (!it || seen[it.id]) return;
            seen[it.id] = true;
            if (GameState.isItemPlaced(it) && it.owner === 'chest') chest.push(it);
            else if (GameState.isItemPlaced(it)) kept.push(it);
            else leftover.push(it);
        };
        GameState.get('backpackItems', []).forEach(collect);
        (this.chestItems || []).forEach(collect);
        GameState.set('backpackItems', kept);
        if (this.fromContainer && this.containerId) {
            GameState.setContainerItems(this.containerId, this.containerName, chest);
        }
        this.scene.stop();
        this.scene.resume(CONFIG.SCENES.GAME);
        EventBus.emit('backpack:closed', {
            leftover: leftover,
            fromContainer: this.fromContainer
        });
    }
}

