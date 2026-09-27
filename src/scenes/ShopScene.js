/* =====================================================================
 * 商店场景：左背包，右上交易（你拿出的 / 你要拿的），右下货架
 * 拖或右键挪物品；确认后滑块砍价。收购价、老板钱、刷新见 shop.json / CONFIG.SHOP
 * ===================================================================== */
class ShopScene extends Phaser.Scene {
    constructor() {
        super({ key: CONFIG.SCENES.SHOP });
    }

    init(data) {
        this.shopId = (data && data.shopId) || '';
        this.shopDef = (data && data.shopDef) || ShopDB.defaultShop();
        this.shopName = (this.shopDef && this.shopDef.name) || '商店';
        this.mapKey = (data && data.mapKey) || '';
    }

    create() {
        const W = this.cameras.main.width, H = this.cameras.main.height;
        this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.62).setDepth(0);
        if (this.input.mouse) this.input.mouse.disableContextMenu();

        this.itemSprites = [];
        this.dragging = null;
        this.bargaining = false;
        this.slider = 0;
        this.previewGfx = this.add.graphics().setDepth(2.5);
        this.gridGfx = this.add.graphics().setDepth(2);

        const st = GameState.getShop(this.shopId) || ShopDB.refreshState(this.shopDef);
        this.shopMoney = st.money != null ? st.money : ShopDB.startMoney(this.shopDef);
        this.dayTurnover = st.turnover || 0;
        this.bagItems = (GameState.get('backpackItems') || []).slice();
        this.giveItems = [];
        this.takeItems = [];
        this.shelfItems = (st.items || []).map(it => {
            if (!it.owner) it.owner = 'shelf';
            return it;
        });

        const cfg = CONFIG.BACKPACK;
        const tCols = CONFIG.SHOP.TRADE_COLS || 4;
        const tRows = CONFIG.SHOP.TRADE_ROWS || 4;
        const sCols = (this.shopDef && this.shopDef.shelfCols) || CONFIG.SHOP.SHELF_COLS || 6;
        const sRows = (this.shopDef && this.shopDef.shelfRows) || CONFIG.SHOP.SHELF_ROWS || 6;
        const lay = this.layoutShop(cfg, tCols, tRows, sCols, sRows, W, H);
        const cell = lay.cell;

        this.bpGrid = this.layoutBackpack(cfg, lay.bpCx, lay.bpCy, lay.bpW, lay.bpH, cell);
        this.giveGrid = this.makePanelGrid('give', tCols, tRows, lay.giveX, lay.tradeY, lay.giveW, lay.tradeH, '你拿出的', cell);
        this.takeGrid = this.makePanelGrid('take', tCols, tRows, lay.takeX, lay.tradeY, lay.takeW, lay.tradeH, '你要拿的', cell);
        this.shelfGrid = this.makePanelGrid('shelf', sCols, sRows, lay.shelfX, lay.shelfY, lay.shelfW, lay.shelfH, '货架', cell);
        this._rightCenterX = lay.rightCx;
        this._tradeBottom = lay.tradeY + lay.tradeH;
        const shelfY = lay.shelfY;

        this.drawGrid();

        this.add.text(this.bpGrid.startX + this.bpGrid.blockW / 2, this.bpGrid.titleY || 28, '背包', {
            fontSize: '22px', color: '#f9e2af', stroke: '#000000', strokeThickness: 4
        }).setOrigin(0.5).setDepth(4);

        this.quoteText = this.add.text(this._rightCenterX, 26, '', {
            fontSize: '16px', color: '#f9e2af', stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(4);

        this.okBtn = this.add.text(this._rightCenterX, this._tradeBottom + 22, '确认交易', {
            fontSize: '20px', color: '#1e1e2e', backgroundColor: '#a6e3a1',
            padding: { x: 16, y: 6 }
        }).setOrigin(0.5).setDepth(5).setInteractive({ useHandCursor: true });

        this.moneyText = this.add.text(this._rightCenterX, shelfY - 8, '', {
            fontSize: '15px', color: '#a6adc8', stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(4);
        this.okBtn.on('pointerdown', () => this.startBargain());
        if (this.shopDef && this.shopDef.lockpickPrice != null) {
            const price = this.shopDef.lockpickPrice;
            this.lockBtn = this.add.text(this._rightCenterX, 50,
                '开锁器 ' + price + ' 金一件，不占货架。点一下放进「你要拿的」', {
                fontSize: '14px', color: '#89b4fa', stroke: '#000000', strokeThickness: 3
            }).setOrigin(0.5).setDepth(5).setInteractive({ useHandCursor: true });
            this.lockBtn.on('pointerdown', () => this.addShopLockpick());
        }

        this.hudRes = this.add.text(16, 16, GameState.hudText(), {
            fontSize: '18px', color: '#f9e2af', backgroundColor: '#00000099',
            padding: { x: 10, y: 6 }
        }).setOrigin(0, 0).setDepth(8);
        this._onHud = () => { if (this.hudRes) this.hudRes.setText(GameState.hudText()); };
        EventBus.on('state:金币', this._onHud);
        EventBus.on('state:开锁器', this._onHud);
        EventBus.on('state:生命', this._onHud);
        EventBus.on('state:生命上限', this._onHud);
        EventBus.on('state:等级', this._onHud);
        EventBus.on('state:经验', this._onHud);
        EventBus.on('state:通缉等级', this._onHud);

        this.add.text(W / 2, H - 20, '拖或右键挪到交易区  ·  确认后砍价  ·  Esc 关闭（未成交的会退回）', {
            fontSize: '15px', color: '#a6adc8'
        }).setOrigin(0.5).setDepth(4);

        this.bagItems.forEach(it => { it.owner = it.owner || 'backpack'; this.spawnSprite(it); });
        this.shelfItems.forEach(it => { it.owner = 'shelf'; this.spawnSprite(it); });
        this.refreshQuote();

        this.esc = this.input.keyboard.addKey('ESC');
        this.rKey = this.input.keyboard.addKey('R');
        this.input.keyboard.on('keydown-R', () => this.rotateDragging());

        this.events.once('shutdown', () => {
            this.hideItemTip();
            EventBus.off('state:金币', this._onHud);
            EventBus.off('state:开锁器', this._onHud);
            EventBus.off('state:生命', this._onHud);
            EventBus.off('state:生命上限', this._onHud);
            EventBus.off('state:等级', this._onHud);
            EventBus.off('state:经验', this._onHud);
            EventBus.off('state:通缉等级', this._onHud);
        });
    }

    update() {
        if (!Phaser.Input.Keyboard.JustDown(this.esc)) return;
        if (this.bargaining) this.cancelBargain();
        else this.closeShop();
    }

    /**
     * 尽量铺满窗口，且背包/交易/货架单格一样大（和开箱同一原则）
     */
    layoutShop(cfg, tCols, tRows, sCols, sRows, screenW, screenH) {
        const tex = this.textures.get(cfg.BG_KEY).getSourceImage();
        const gr = cfg.GRID_RECT;
        const factor = Math.min(gr.w / cfg.GRID_COLS, gr.h / cfg.GRID_ROWS);
        const availW = screenW - 20;
        const availH = screenH - 64;
        const midGap = 16;
        const panelPad = 20;
        const tradeGap = 12;
        const extraW = 2 * panelPad + tradeGap;
        const extraH = 186;
        const kBpW = tex.width / factor;
        const kBpH = tex.height / factor;
        const cellW = (availW - midGap - extraW) / (kBpW + 2 * tCols);
        const cellH = Math.min(availH / kBpH, (availH - extraH) / (tRows + sRows));
        const cell = Math.max(22, Math.min(cellW, cellH));

        const bpW = kBpW * cell;
        const bpH = kBpH * cell;
        const giveW = tCols * cell + panelPad;
        const takeW = tCols * cell + panelPad;
        const tradeW = giveW + tradeGap + takeW;
        const tradeH = tRows * cell + 40;
        const shelfW = sCols * cell + panelPad;
        const shelfH = sRows * cell + 40;
        const rightW = Math.max(tradeW, shelfW);
        const rightH = 28 + tradeH + 50 + shelfH;
        const totalW = bpW + midGap + rightW;
        const totalH = Math.max(bpH, rightH);
        const left = (screenW - totalW) / 2;
        const top = (screenH - totalH) / 2 + 6;
        const rx = left + bpW + midGap;
        const tradeY = top + 28;
        return {
            cell: cell,
            bpCx: left + bpW / 2,
            bpCy: top + totalH / 2,
            bpW: bpW,
            bpH: bpH,
            giveX: rx,
            takeX: rx + giveW + tradeGap,
            giveW: giveW,
            takeW: takeW,
            tradeY: tradeY,
            tradeH: tradeH,
            shelfX: rx + (rightW - shelfW) / 2,
            shelfY: tradeY + tradeH + 50,
            shelfW: shelfW,
            shelfH: shelfH,
            rightCx: rx + rightW / 2
        };
    }

    layoutBackpack(cfg, cx, cy, maxW, maxH, targetCell) {
        const tex = this.textures.get(cfg.BG_KEY).getSourceImage();
        const gr = cfg.GRID_RECT, cols = cfg.GRID_COLS, rows = cfg.GRID_ROWS;
        const factor = Math.min(gr.w / cols, gr.h / rows);
        const scale = targetCell ? (targetCell / factor) : Math.min(maxW / tex.width, maxH / tex.height);
        const dispW = tex.width * scale, dispH = tex.height * scale;
        const ox = cx - dispW / 2, oy = cy - dispH / 2;
        this.add.image(cx, cy, cfg.BG_KEY).setDisplaySize(dispW, dispH).setDepth(1);
        const gridW = gr.w * scale, gridH = gr.h * scale;
        const cell = targetCell || Math.min(gridW / cols, gridH / rows);
        const blockW = cell * cols, blockH = cell * rows;
        const gx = ox + gr.x * scale, gy = oy + gr.y * scale;
        return {
            kind: 'backpack',
            startX: gx + (gridW - blockW) / 2,
            startY: gy + (gridH - blockH) / 2,
            cellSize: cell, cols: cols, rows: rows, blockW: blockW, blockH: blockH,
            allUnlocked: false, titleY: oy + gr.y * scale * 0.4
        };
    }

    makePanelGrid(kind, cols, rows, x, y, w, h, title, cell) {
        this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x181825, 0.95)
            .setStrokeStyle(2, 0x45475a).setDepth(1);
        this.add.text(x + w / 2, y + 14, title, {
            fontSize: '15px', color: '#cdd6f4'
        }).setOrigin(0.5).setDepth(4);
        const blockW = cell * cols, blockH = cell * rows;
        return {
            kind: kind,
            startX: x + (w - blockW) / 2,
            startY: y + 28 + (h - 36 - blockH) / 2,
            cellSize: cell, cols: cols, rows: rows, blockW: blockW, blockH: blockH,
            allUnlocked: true
        };
    }

    listByOwner(owner) {
        if (owner === 'backpack') return this.bagItems;
        if (owner === 'give') return this.giveItems;
        if (owner === 'take') return this.takeItems;
        return this.shelfItems;
    }

    gridFor(it) {
        const o = it && it.owner;
        if (o === 'give') return this.giveGrid;
        if (o === 'take') return this.takeGrid;
        if (o === 'shelf') return this.shelfGrid;
        return this.bpGrid;
    }

    footprint(it) {
        return (it.rot % 2 === 1) ? { dw: it.h, dh: it.w } : { dw: it.w, dh: it.h };
    }

    artSize(it, cellSize) {
        const t = ItemDB.texSize(this, it);
        return ItemDB.fitArt(it, cellSize, t.w, t.h, 6);
    }

    bounceItem(it, sprite) {
        if (!sprite || !sprite.active) {
            const entry = this.itemSprites.find(e => e.data === it);
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

    allItems() {
        return this.bagItems.concat(this.giveItems, this.takeItems, this.shelfItems);
    }

    drawOne(grid, items) {
        if (!grid) return;
        const g = this.gridGfx;
        const colors = CONFIG.BACKPACK.RARITY_COLORS || {};
        for (let r = 0; r < grid.rows; r++) {
            for (let c = 0; c < grid.cols; c++) {
                const x = grid.startX + c * grid.cellSize, y = grid.startY + r * grid.cellSize;
                const unlocked = grid.allUnlocked || GameState.isCellUnlocked(c, r);
                if (unlocked) {
                    g.fillStyle(0x2b2b2b, 0.85).fillRect(x + 2, y + 2, grid.cellSize - 4, grid.cellSize - 4);
                    g.lineStyle(2, 0xcba6f7, 0.55).strokeRect(x + 2, y + 2, grid.cellSize - 4, grid.cellSize - 4);
                } else {
                    g.fillStyle(0x1a1a1a, 0.85).fillRect(x + 2, y + 2, grid.cellSize - 4, grid.cellSize - 4);
                    g.lineStyle(2, 0x45475a, 0.7).strokeRect(x + 2, y + 2, grid.cellSize - 4, grid.cellSize - 4);
                }
            }
        }
        items.forEach(it => {
            if (!GameState.isItemPlaced(it) || it.owner !== grid.kind) return;
            const color = colors[it.rarity] || colors.common;
            ItemDB.cellsOf(it).forEach(p => {
                const x = grid.startX + (it.col + p.c) * grid.cellSize;
                const y = grid.startY + (it.row + p.r) * grid.cellSize;
                g.fillStyle(color, 0.38).fillRect(x + 2, y + 2, grid.cellSize - 4, grid.cellSize - 4);
                g.lineStyle(2, color, 0.9).strokeRect(x + 2, y + 2, grid.cellSize - 4, grid.cellSize - 4);
            });
        });
    }

    drawGrid() {
        this.gridGfx.clear();
        const all = this.allItems();
        this.drawOne(this.bpGrid, all);
        this.drawOne(this.giveGrid, all);
        this.drawOne(this.takeGrid, all);
        this.drawOne(this.shelfGrid, all);
    }

    canOccupy(grid, it, col, row, ignore) {
        if (!grid) return false;
        const cells = ItemDB.cellsOf(it);
        for (let i = 0; i < cells.length; i++) {
            const c = col + cells[i].c, r = row + cells[i].r;
            if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return false;
            if (!grid.allUnlocked && !GameState.isCellUnlocked(c, r)) return false;
        }
        const others = this.listByOwner(grid.kind);
        for (let i = 0; i < others.length; i++) {
            const o = others[i];
            if (o === it || o === ignore || !GameState.isItemPlaced(o)) continue;
            const oc = ItemDB.cellsOf(o);
            for (let a = 0; a < cells.length; a++) {
                for (let b = 0; b < oc.length; b++) {
                    if (col + cells[a].c === o.col + oc[b].c && row + cells[a].r === o.row + oc[b].r) return false;
                }
            }
        }
        return true;
    }

    findSlot(grid, it) {
        const start = it.rot || 0;
        for (let k = 0; k < 4; k++) {
            it.rot = (start + k) % 4;
            for (let r = 0; r < grid.rows; r++) {
                for (let c = 0; c < grid.cols; c++) {
                    if (this.canOccupy(grid, it, c, r)) return { col: c, row: r, rot: it.rot };
                }
            }
        }
        it.rot = start;
        return null;
    }

    moveToList(it, from, to) {
        const i = from.indexOf(it);
        if (i >= 0) from.splice(i, 1);
        if (to.indexOf(it) < 0) to.push(it);
    }

    snap(it) {
        const grid = this.gridFor(it);
        const { dw, dh } = this.footprint(it);
        const entry = this.itemSprites.find(e => e.data === it);
        if (!entry) return;
        const pxW = dw * grid.cellSize, pxH = dh * grid.cellSize;
        entry.sprite.x = grid.startX + it.col * grid.cellSize + pxW / 2;
        entry.sprite.y = grid.startY + it.row * grid.cellSize + pxH / 2;
        const art = this.artSize(it, grid.cellSize);
        entry.sprite.setDisplaySize(art.w, art.h);
        entry.sprite.setAngle((it.rot || 0) * 90);
    }

    spawnSprite(it) {
        const grid = this.gridFor(it);
        const { dw, dh } = this.footprint(it);
        const pxW = dw * grid.cellSize, pxH = dh * grid.cellSize;
        const cx = grid.startX + (it.col || 0) * grid.cellSize + pxW / 2;
        const cy = grid.startY + (it.row || 0) * grid.cellSize + pxH / 2;
        const key = (it.image && this.textures.exists('item:' + it.image))
            ? ('item:' + it.image)
            : (this.textures.exists('item:missing') ? 'item:missing' : it.image);
        const art = this.artSize(it, grid.cellSize);
        const sprite = this.add.image(cx, cy, key).setDisplaySize(art.w, art.h).setDepth(3);
        sprite.setAngle((it.rot || 0) * 90);
        sprite.setInteractive({ draggable: true, useHandCursor: true });
        this.input.setDraggable(sprite);
        sprite.on('pointerdown', (ptr) => {
            if (this.bargaining) return;
            if (ptr.rightButtonDown() || ptr.button === 2) {
                this.quickMove(it);
                return;
            }
            this._press = { x: ptr.x, y: ptr.y };
        });
        sprite.on('dragstart', (ptr) => {
            this.hideItemTip();
            if (this.bargaining || (ptr && (ptr.rightButtonDown() || ptr.button === 2))) {
                this.input.setDraggable(sprite, false);
                this.time.delayedCall(0, () => this.input.setDraggable(sprite, true));
                return;
            }
            sprite.setDepth(10);
            this.dragging = { data: it, sprite: sprite, fromOwner: it.owner, fromCol: it.col, fromRow: it.row, fromRot: it.rot };
        });
        sprite.on('drag', (ptr) => {
            if (!this.dragging) return;
            sprite.x = ptr.x;
            sprite.y = ptr.y;
            this.updatePreview();
        });
        sprite.on('dragend', () => {
            if (this.dragging) this.drop();
            sprite.setDepth(3);
            this.previewGfx.clear();
            this.dragging = null;
        });
        sprite.on('pointerover', (ptr) => {
            if (this.dragging || this.bargaining) return;
            this.showItemTip(it, ptr);
        });
        sprite.on('pointermove', (ptr) => {
            if (this.dragging || this.bargaining) { this.hideItemTip(); return; }
            this.moveItemTip(ptr);
        });
        sprite.on('pointerout', () => this.hideItemTip());
        this.itemSprites.push({ data: it, sprite: sprite });
        if (window.ItemDB && ItemDB.tintPoisoned) ItemDB.tintPoisoned(sprite, it);
        this.snap(it);
    }

    showItemTip(it, ptr) {
        this.hideItemTip();
        if (!it) return;
        const text = (window.ItemDB && ItemDB.tooltipText)
            ? ItemDB.tooltipText(it)
            : ((it.name || '物品') + (it.desc ? ('\n' + it.desc) : ''));
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

    grids() {
        return [this.bpGrid, this.giveGrid, this.takeGrid, this.shelfGrid];
    }

    hitGrid(x, y) {
        const list = this.grids();
        for (let i = 0; i < list.length; i++) {
            const g = list[i];
            if (x >= g.startX && x <= g.startX + g.blockW && y >= g.startY && y <= g.startY + g.blockH) return g;
        }
        return null;
    }

    allowedDrop(fromOwner, toKind) {
        if (fromOwner === toKind) return true;
        if (fromOwner === 'backpack' && toKind === 'give') return true;
        if (fromOwner === 'give' && toKind === 'backpack') return true;
        if (fromOwner === 'shelf' && toKind === 'take') return true;
        if (fromOwner === 'take' && toKind === 'shelf') return true;
        return false;
    }

    targetOf(owner) {
        if (owner === 'backpack') return { grid: this.giveGrid, from: this.bagItems, to: this.giveItems, owner: 'give' };
        if (owner === 'give') return { grid: this.bpGrid, from: this.giveItems, to: this.bagItems, owner: 'backpack' };
        if (owner === 'shelf') return { grid: this.takeGrid, from: this.shelfItems, to: this.takeItems, owner: 'take' };
        if (owner === 'take') return { grid: this.shelfGrid, from: this.takeItems, to: this.shelfItems, owner: 'shelf' };
        return null;
    }

    quickMove(it) {
        if (this.bargaining) return;
        const dest = this.targetOf(it.owner);
        if (!dest) return;
        if (dest.owner === 'give' && !ShopDB.canSell(it)) {
            this.showHint('这件不能卖（剧情/钥匙/独特）');
            return;
        }
        const slot = this.findSlot(dest.grid, it);
        if (!slot) {
            this.showHint('那边放不下');
            return;
        }
        this.moveToList(it, dest.from, dest.to);
        it.owner = dest.owner;
        it.col = slot.col;
        it.row = slot.row;
        it.rot = slot.rot;
        it.placed = true;
        this.snap(it);
        this.bounceItem(it);
        this.drawGrid();
        this.refreshQuote();
    }

    drop() {
        const it = this.dragging.data;
        const ptr = this.input.activePointer;
        const grid = this.hitGrid(ptr.x, ptr.y);
        const revert = () => {
            it.owner = this.dragging.fromOwner;
            it.col = this.dragging.fromCol;
            it.row = this.dragging.fromRow;
            it.rot = this.dragging.fromRot;
            it.placed = true;
            this.snap(it);
        };
        if (!grid || !this.allowedDrop(this.dragging.fromOwner, grid.kind)) {
            revert();
            return;
        }
        if (grid.kind === 'give' && !ShopDB.canSell(it)) {
            this.showHint('这件不能卖（剧情/钥匙/独特）');
            revert();
            return;
        }
        const col = Math.floor((ptr.x - grid.startX) / grid.cellSize);
        const row = Math.floor((ptr.y - grid.startY) / grid.cellSize);
        if (!this.canOccupy(grid, it, col, row, it)) {
            const slot = this.findSlot(grid, it);
            if (!slot) { revert(); return; }
            it.col = slot.col; it.row = slot.row; it.rot = slot.rot;
        } else {
            it.col = col; it.row = row;
        }
        if (it.owner !== grid.kind) {
            this.moveToList(it, this.listByOwner(it.owner), this.listByOwner(grid.kind));
            it.owner = grid.kind;
        }
        it.placed = true;
        this.snap(it);
        this.bounceItem(it, this.dragging && this.dragging.sprite);
        this.drawGrid();
        this.refreshQuote();
    }

    updatePreview() {
        this.previewGfx.clear();
        if (!this.dragging) return;
        const ptr = this.input.activePointer;
        const grid = this.hitGrid(ptr.x, ptr.y);
        if (!grid) return;
        const it = this.dragging.data;
        const ok = this.allowedDrop(this.dragging.fromOwner, grid.kind)
            && !(grid.kind === 'give' && !ShopDB.canSell(it));
        const col = Math.floor((ptr.x - grid.startX) / grid.cellSize);
        const row = Math.floor((ptr.y - grid.startY) / grid.cellSize);
        const fit = ok && this.canOccupy(grid, it, col, row, it);
        const color = fit ? 0xa6e3a1 : 0xf38ba8;
        ItemDB.cellsOf(it).forEach(p => {
            const x = grid.startX + (col + p.c) * grid.cellSize;
            const y = grid.startY + (row + p.r) * grid.cellSize;
            this.previewGfx.fillStyle(color, 0.28).fillRect(x + 2, y + 2, grid.cellSize - 4, grid.cellSize - 4);
        });
    }

    rotateDragging() {
        if (!this.dragging || this.bargaining) return;
        const it = this.dragging.data;
        it.rot = (it.rot + 1) % 4;
        const cell = this.gridFor(it).cellSize;
        const art = this.artSize(it, cell);
        this.dragging.sprite.setDisplaySize(art.w, art.h);
        this.dragging.sprite.setAngle(it.rot * 90);
        this.updatePreview();
    }

    refreshQuote() {
        const q = ShopDB.quote(this.giveItems, this.takeItems, this.shopDef);
        this._quote = q;
        let line = window.t('shop.moneyLeft', this.shopName + ' · 老板还有 {n} 格罗申', { shop: this.shopName, n: this.shopMoney });
        if (!this.giveItems.length && !this.takeItems.length) {
            this.quoteText.setText('把要卖的放到上面左边，要买的放到上面右边');
        } else if (q.diff > 0) {
            this.quoteText.setText(window.t('shop.quotePay', '公平价：你将付出 {n} 格罗申', { n: q.diff }));
        } else if (q.diff < 0) {
            this.quoteText.setText(window.t('shop.quoteGet', '公平价：你将得到 {n} 格罗申', { n: -q.diff }));
        } else {
            this.quoteText.setText('公平价：只换物，不碰钱');
        }
        this.moneyText.setText(line);
        if (this.hudRes) this.hudRes.setText(GameState.hudText());
        if (this.dealText) this.refreshDealText();
    }

    showHint(msg) {
        if (this.hintText) this.hintText.destroy();
        this.hintText = this.add.text(this.cameras.main.width / 2, this.cameras.main.height - 56, msg, {
            fontSize: '18px', color: '#f38ba8', stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(20);
        this.time.delayedCall(1600, () => {
            if (this.hintText) { this.hintText.destroy(); this.hintText = null; }
        });
    }

    startBargain() {
        if (this.bargaining) return;
        if (!this.giveItems.length && !this.takeItems.length) {
            this.showHint('先把要交易的东西放到交易区');
            return;
        }
        this.bargaining = true;
        this.slider = 0;
        const W = this.cameras.main.width, H = this.cameras.main.height;
        this.overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55).setDepth(15);
        this.panel = this.add.rectangle(W / 2, H / 2, 520, 260, 0x1e1e2e, 0.98)
            .setStrokeStyle(2, 0xcba6f7).setDepth(16);
        this.bargainTitle = this.add.text(W / 2, H / 2 - 96, '砍价', {
            fontSize: '22px', color: '#cdd6f4'
        }).setOrigin(0.5).setDepth(17);
        this.dealText = this.add.text(W / 2, H / 2 - 56, '', {
            fontSize: '18px', color: '#f9e2af'
        }).setOrigin(0.5).setDepth(17);
        this.bargainHint = this.add.text(W / 2, H / 2 + 8, '往左：少给 / 多得　　往右：多给 / 少得', {
            fontSize: '14px', color: '#a6adc8'
        }).setOrigin(0.5).setDepth(17);
        this.track = this.add.rectangle(W / 2, H / 2 - 10, 360, 10, 0x45475a).setDepth(17);
        this.knob = this.add.circle(W / 2, H / 2 - 10, 14, 0xa6e3a1).setDepth(18)
            .setInteractive({ draggable: true, useHandCursor: true });
        this.input.setDraggable(this.knob);
        this.knob.on('drag', (ptr) => {
            const minX = W / 2 - 180, maxX = W / 2 + 180;
            const x = Math.max(minX, Math.min(maxX, ptr.x));
            this.knob.x = x;
            this.slider = (x - W / 2) / 180;
            this.refreshDealText();
        });
        this.yesBtn = this.add.text(W / 2 - 80, H / 2 + 78, '成交', {
            fontSize: '20px', color: '#1e1e2e', backgroundColor: '#a6e3a1', padding: { x: 16, y: 6 }
        }).setOrigin(0.5).setDepth(17).setInteractive({ useHandCursor: true });
        this.noBtn = this.add.text(W / 2 + 80, H / 2 + 78, '取消', {
            fontSize: '20px', color: '#cdd6f4', backgroundColor: '#45475a', padding: { x: 16, y: 6 }
        }).setOrigin(0.5).setDepth(17).setInteractive({ useHandCursor: true });
        this.yesBtn.on('pointerdown', () => this.commitDeal());
        this.noBtn.on('pointerdown', () => this.cancelBargain());
        this.refreshDealText();
    }

    refreshDealText() {
        if (!this.dealText) return;
        const q = this._quote || ShopDB.quote(this.giveItems, this.takeItems, this.shopDef);
        const s = ShopDB.settle(q.diff, this.slider, this.shopDef);
        if (s.pay > 0) this.dealText.setText(window.t('shop.dealPay', '成交后你付出 {n} 格罗申', { n: s.pay }));
        else if (s.receive > 0) this.dealText.setText(window.t('shop.dealGet', '成交后你得到 {n} 格罗申', { n: s.receive }));
        else this.dealText.setText('成交后只换物，不碰钱');
    }

    cancelBargain() {
        this.bargaining = false;
        this.slider = 0;
        [this.overlay, this.panel, this.dealText, this.track, this.knob, this.yesBtn, this.noBtn, this.bargainTitle, this.bargainHint].forEach(o => {
            if (o && o.destroy) o.destroy();
        });
        this.overlay = this.panel = this.dealText = this.track = this.knob = this.yesBtn = this.noBtn = this.bargainTitle = this.bargainHint = null;
    }

    commitDeal() {
        const q = ShopDB.quote(this.giveItems, this.takeItems, this.shopDef);
        const s = ShopDB.settle(q.diff, this.slider, this.shopDef);
        const gold = GameState.get('金币', 0);
        if (s.pay > gold) {
            this.showHint(window.t('shop.noGold', '你的格罗申不够'));
            return;
        }
        if (s.receive > this.shopMoney) {
            this.showHint('老板钱不够，再少要点或少卖点');
            return;
        }
        this.takeItems.forEach(it => {
            if (it.data && it.data.isShopLockpick) {
                GameState.gainLockpicks(ItemDB.lockpickAmount(it) || 1);
            } else {
                const slot = this.findSlot(this.bpGrid, it);
                if (slot) {
                    it.owner = 'backpack';
                    it.col = slot.col; it.row = slot.row; it.rot = slot.rot;
                    it.placed = true;
                    this.bagItems.push(it);
                } else {
                    it.owner = 'backpack';
                    it.placed = false;
                    it.col = -1; it.row = -1;
                    it.looseOX = 90; it.looseOY = -70;
                    this.bagItems.push(it);
                }
            }
        });
        this.giveItems = [];
        this.takeItems = [];
        if (s.pay) GameState.add('金币', -s.pay);
        if (s.receive) GameState.add('金币', s.receive);
        this.shopMoney = this.shopMoney + s.pay - s.receive;
        this.dayTurnover = (this.dayTurnover || 0) + (s.pay || 0) + (s.receive || 0);
        this.persistShop();
        GameState.set('backpackItems', this.bagItems);
        this.cancelBargain();
        this.itemSprites.forEach(e => { if (e.sprite) e.sprite.destroy(); });
        this.itemSprites = [];
        this.bagItems.forEach(it => this.spawnSprite(it));
        this.shelfItems.forEach(it => this.spawnSprite(it));
        this.drawGrid();
        this.refreshQuote();
        this.showHint('成交了');
    }

    persistShop() {
        const prev = GameState.getShop(this.shopId) || {};
        GameState.setShop(this.shopId, {
            money: this.shopMoney,
            items: this.shelfItems.concat(this.takeItems),
            refreshedAt: prev.refreshedAt != null ? prev.refreshedAt : GameState.gameTime(),
            dayIndex: prev.dayIndex != null ? prev.dayIndex : (ShopDB.dayIndex ? ShopDB.dayIndex() : 0),
            turnover: this.dayTurnover || 0
        });
    }

    addShopLockpick() {
        if (!this.shopDef || this.shopDef.lockpickPrice == null || !window.ItemDB) return;
        const inst = ItemDB.createInstance('lockpick', {
            owner: 'take',
            placed: true,
            data: { shopPrice: this.shopDef.lockpickPrice, isShopLockpick: true }
        });
        if (!inst) return;
        const slot = this.findSlot(this.takeGrid, inst);
        if (!slot) {
            this.showHint('交易格满了');
            return;
        }
        inst.col = slot.col;
        inst.row = slot.row;
        inst.rot = slot.rot;
        inst.owner = 'take';
        this.takeItems.push(inst);
        this.spawnSprite(inst);
        this.drawGrid();
        this.refreshQuote();
    }

    closeShop() {
        this.giveItems.forEach(it => {
            const slot = this.findSlot(this.bpGrid, it);
            it.owner = 'backpack';
            if (slot) {
                it.col = slot.col; it.row = slot.row; it.rot = slot.rot; it.placed = true;
            } else {
                it.placed = false; it.col = -1; it.row = -1;
            }
            this.bagItems.push(it);
        });
        this.takeItems.forEach(it => {
            if (it.data && it.data.isShopLockpick) return;
            const slot = this.findSlot(this.shelfGrid, it);
            it.owner = 'shelf';
            if (slot) {
                it.col = slot.col; it.row = slot.row; it.rot = slot.rot; it.placed = true;
            }
            this.shelfItems.push(it);
        });
        this.giveItems = [];
        this.takeItems = [];
        GameState.set('backpackItems', this.bagItems);
        this.persistShop();
        this.scene.stop();
        this.scene.resume(CONFIG.SCENES.GAME);
    }
}
