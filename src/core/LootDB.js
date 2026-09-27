/* =====================================================================
 * 掉落表（LootDB.js）
 * =====================================================================
 * 读 loot.json，按表抽箱子里的东西，并尽量塞进木/铁/金箱格子。
 * 编辑器和游戏共用这一份，试抽和开箱结果算法相同。
 * ===================================================================== */
window.LootDB = {
    tables: [],
    byId: {},

    async load() {
        try {
            const res = await fetch('assets/configs/loot.json?t=' + Date.now());
            const json = await res.json();
            this.tables = json.tables || [];
            this.byId = {};
            this.tables.forEach(t => { if (t && t.id) this.byId[t.id] = t; });
        } catch (e) {
            console.warn('LootDB: 读 loot.json 失败', e);
            this.tables = [];
            this.byId = {};
        }
    },

    get(id) {
        return this.byId[id] || null;
    },

    /** 地图箱子在存档里的代号：地图 + 摆件 id */
    containerId(mapKey, itemData) {
        const id = (itemData && (itemData.id || itemData.name)) || 'box';
        return (mapKey || 'map') + ':' + id;
    },

    isChest(itemData) {
        if (!itemData) return false;
        if (itemData.action === 'steal') return true;
        return itemData.action === 'open' && !!itemData.lockLevel;
    },

    tableFor(itemData) {
        const id = itemData && itemData.lootTable;
        if (id && this.byId[id]) return this.byId[id];
        const lv = (itemData && itemData.lockLevel) || 1;
        return this.tables.find(t => t.isDefault && t.lockLevel === lv)
            || this.tables.find(t => t.lockLevel === lv)
            || this.tables[0]
            || null;
    },

    chestGrid(lockLevel) {
        const c = (window.CONFIG && CONFIG.CHESTS && CONFIG.CHESTS[lockLevel]) || (CONFIG && CONFIG.CHESTS && CONFIG.CHESTS[1]);
        if (!c) return { cols: 4, rows: 3, name: '箱子' };
        return { cols: c.cols, rows: c.rows, name: c.name || '箱子' };
    },

    keepOnRefresh(it) {
        return !!(it && it.data && (it.data.keepOnRefresh || it.data.unique));
    },

    rowAmount(row) {
        const a = parseInt(row && row.min, 10);
        const b = parseInt(row && row.max, 10);
        const min = isFinite(a) && a > 0 ? a : 1;
        const max = isFinite(b) && b >= min ? b : min;
        return min + Math.floor(Math.random() * (max - min + 1));
    },

    pickWeighted(pool) {
        const list = (pool || []).filter(r => r && (r.weight || 0) > 0);
        let sum = 0;
        list.forEach(r => { sum += r.weight; });
        if (sum <= 0) return null;
        let n = Math.random() * sum;
        for (let i = 0; i < list.length; i++) {
            n -= list[i].weight;
            if (n <= 0) return list[i];
        }
        return list[list.length - 1];
    },

    skipUnique(row, ctx) {
        if (!row || !row.unique) return false;
        if (ctx && ctx.ignoreUnique) return false;
        const id = row.itemId;
        if (!id) return false;
        if (ctx && ctx.granted && ctx.granted[id]) return true;
        if (ctx && typeof ctx.hasDef === 'function' && ctx.hasDef(id)) return true;
        return false;
    },

    /** 一行抽成资源或道具代号。同一件可抽多次（独特行除外） */
    resolveRow(row, ctx) {
        const out = { gold: 0, lockpicks: 0, defs: [] };
        if (!row) return out;
        const n = this.rowAmount(row);
        const kind = row.kind || 'item';
        if (kind === 'gold') {
            out.gold = n;
            return out;
        }
        if (kind === 'lockpick') {
            const copies = n;
            for (let i = 0; i < copies; i++) out.defs.push({ defId: 'lockpick', unique: false });
            return out;
        }
        if (!row.itemId) return out;
        if (this.skipUnique(row, ctx)) return out;
        const copies = row.unique ? 1 : n;
        for (let i = 0; i < copies; i++) {
            out.defs.push({ defId: row.itemId, unique: !!row.unique });
        }
        return out;
    },

    cellsOfInst(it) {
        if (window.ItemDB && ItemDB.cellsOf) return ItemDB.cellsOf(it);
        const w = (it.rot % 2 === 1) ? (it.h || 1) : (it.w || 1);
        const h = (it.rot % 2 === 1) ? (it.w || 1) : (it.h || 1);
        const cells = [];
        for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) cells.push({ c: c, r: r });
        return cells;
    },

    canPlace(occ, it, col, row, cols, rows) {
        const cells = this.cellsOfInst(it);
        for (let i = 0; i < cells.length; i++) {
            const c = col + cells[i].c, r = row + cells[i].r;
            if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
            if (occ[r][c]) return false;
        }
        return true;
    },

    occupy(occ, it, col, row) {
        const cells = this.cellsOfInst(it);
        for (let i = 0; i < cells.length; i++) {
            occ[row + cells[i].r][col + cells[i].c] = 1;
        }
    },

    emptyGrid(cols, rows) {
        const occ = [];
        for (let r = 0; r < rows; r++) {
            occ[r] = [];
            for (let c = 0; c < cols; c++) occ[r][c] = 0;
        }
        return occ;
    },

    tryPlaceInst(occ, it, cols, rows) {
        const startRot = it.rot || 0;
        for (let k = 0; k < 4; k++) {
            it.rot = (startRot + k) % 4;
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    if (this.canPlace(occ, it, c, r, cols, rows)) {
                        it.col = c;
                        it.row = r;
                        it.placed = true;
                        it.owner = 'chest';
                        this.occupy(occ, it, c, r);
                        return true;
                    }
                }
            }
        }
        it.rot = startRot;
        return false;
    },

    isQuestDef(def) {
        if (!def) return true;
        if (def.type === '任务') return true;
        return !!(def.effect && def.effect.type === 'quest');
    },

    /** 这口箱在「任务进行中」才出的东西。每件全游戏只放一次，拿走后不再刷。 */
    questLootRows(itemData) {
        const list = (itemData && itemData.questLoot) || [];
        if (!list.length || !window.QuestDB) return [];
        const rows = [];
        list.forEach(row => {
            if (!row || !row.questId || !row.itemId) return;
            if (!QuestDB.isActive(row.questId)) return;
            rows.push({
                kind: 'item',
                itemId: row.itemId,
                unique: true,
                min: 1,
                max: 1,
                weight: 1
            });
        });
        return rows;
    },

    /**
     * 箱子已经生成过时，补上刚接到的任务物。
     * 已经在箱里、背包里、地上，或曾经放过，就不再放第二件。
     */
    injectQuestLoot(itemData, items, ctx) {
        const rows = this.questLootRows(itemData);
        const out = { changed: false, skipped: [] };
        if (!rows.length || !items) return out;
        ctx = ctx || {};
        const lv = (itemData && itemData.lockLevel) || 1;
        const grid = this.chestGrid(lv);
        const occ = this.emptyGrid(grid.cols, grid.rows);
        items.forEach(it => {
            if (!it || it.placed === false || it.col < 0 || it.row < 0) return;
            if (this.canPlace(occ, it, it.col, it.row, grid.cols, grid.rows)) {
                this.occupy(occ, it, it.col, it.row);
            }
        });
        rows.forEach(row => {
            const got = this.resolveRow(row, ctx);
            got.defs.forEach(d => {
                if (items.some(it => it && it.defId === d.defId)) return;
                const inst = this.makeInst(d.defId, true);
                if (!inst) {
                    out.skipped.push(d.defId + '（图鉴没有）');
                    return;
                }
                if (this.tryPlaceInst(occ, inst, grid.cols, grid.rows)) {
                    items.push(inst);
                    if (ctx.grant) ctx.grant(d.defId);
                    out.changed = true;
                } else {
                    out.skipped.push((inst.name || d.defId) + '（格子满了）');
                }
            });
        });
        return out;
    },

    itemsOfQuality(q) {
        const list = (window.ItemDB && ItemDB.list) || [];
        return list.filter(def => {
            if (!def || !def.id || this.isQuestDef(def)) return false;
            if (def.type === '容器') return false;
            return ItemDB.qualityOf(def) === q;
        });
    },

    /** 先按品质权重抽，再在该品质里等概率抽一件。任务物和容器不进池。 */
    pickQualityItem(rates) {
        const usable = (rates || []).filter(r => r && (r.weight || 0) > 0 && this.itemsOfQuality(r.quality).length);
        const row = this.pickWeighted(usable.map(r => ({ quality: r.quality, weight: r.weight })));
        if (!row) return null;
        const pool = this.itemsOfQuality(row.quality);
        if (!pool.length) return null;
        return pool[Math.floor(Math.random() * pool.length)];
    },

    rollCount(table) {
        const minR = parseInt(table && table.rollsMin, 10);
        const maxR = parseInt(table && table.rollsMax, 10);
        const a = isFinite(minR) && minR > 0 ? minR : 1;
        const b = isFinite(maxR) && maxR >= a ? maxR : a;
        return a + Math.floor(Math.random() * (b - a + 1));
    },

    makeInst(defId, unique) {
        if (!window.ItemDB) return null;
        const inst = ItemDB.createInstance(defId, {
            owner: 'chest',
            placed: true,
            data: { unique: !!unique, keepOnRefresh: !!unique }
        });
        return inst;
    },

    /**
     * 按表 + 箱子「额外必出」生成一批可放入的实例。
     * existing = 刷新后留下的独特物（会优先占格）。
     */
    generate(itemData, existing, ctx) {
        ctx = ctx || {};
        const table = this.tableFor(itemData);
        const lv = (itemData && itemData.lockLevel) || (table && table.lockLevel) || 1;
        const grid = this.chestGrid(lv);
        const occ = this.emptyGrid(grid.cols, grid.rows);
        const placed = [];
        const skipped = [];
        let gold = 0, lockpicks = 0;

        const keep = (existing || []).filter(it => this.keepOnRefresh(it));
        keep.forEach(it => {
            if (it.placed !== false && it.col >= 0 && it.row >= 0 && this.canPlace(occ, it, it.col, it.row, grid.cols, grid.rows)) {
                this.occupy(occ, it, it.col, it.row);
                placed.push(it);
            } else if (this.tryPlaceInst(occ, it, grid.cols, grid.rows)) {
                placed.push(it);
            } else {
                skipped.push((it.name || it.defId || '物品') + '（原箱里的独特物放不下）');
            }
        });

        const extras = (itemData && itemData.extraGuaranteed) || [];
        const rows = this.questLootRows(itemData).concat(extras.map(e => ({
            kind: 'item',
            itemId: e.itemId,
            unique: !!e.unique,
            min: 1,
            max: 1,
            weight: 1
        }))).concat((table && table.guaranteed) || []);

        const addDefs = (defs) => {
            defs.forEach(d => {
                const inst = this.makeInst(d.defId, d.unique);
                if (!inst) {
                    skipped.push(d.defId + '（图鉴没有）');
                    return;
                }
                if (this.tryPlaceInst(occ, inst, grid.cols, grid.rows)) {
                    placed.push(inst);
                    if (d.unique && ctx.grant) ctx.grant(d.defId);
                } else {
                    skipped.push((inst.name || d.defId) + '（格子满了）');
                }
            });
        };

        rows.forEach(row => {
            const got = this.resolveRow(row, ctx);
            gold += got.gold;
            lockpicks += got.lockpicks;
            addDefs(got.defs);
        });

        if (table && (table.qualityRates || []).length) {
            const rolls = this.rollCount(table);
            for (let i = 0; i < rolls; i++) {
                const def = this.pickQualityItem(table.qualityRates);
                if (def) addDefs([{ defId: def.id, unique: false }]);
            }
        } else if (table && (table.pool || []).length) {
            const rolls = this.rollCount(table);
            for (let i = 0; i < rolls; i++) {
                const row = this.pickWeighted(table.pool);
                const got = this.resolveRow(row, ctx);
                gold += got.gold;
                lockpicks += got.lockpicks;
                addDefs(got.defs);
            }
        }

        return {
            items: placed,
            gold: gold,
            lockpicks: lockpicks,
            skipped: skipped,
            cols: grid.cols,
            rows: grid.rows,
            tableName: table ? table.name : '（没有表）'
        };
    },

    /** 战斗等不占箱子格：只抽代号和钱，由外面决定放背包还是掉地上 */
    roll(tableId, ctx) {
        ctx = ctx || {};
        const table = typeof tableId === 'string' ? this.get(tableId) : tableId;
        const out = { gold: 0, lockpicks: 0, defs: [], tableName: table ? table.name : '' };
        if (!table) return out;
        const take = (row) => {
            const got = this.resolveRow(row, ctx);
            out.gold += got.gold;
            out.lockpicks += got.lockpicks;
            (got.defs || []).forEach(d => out.defs.push(d));
        };
        ((table.guaranteed) || []).forEach(take);
        if ((table.pool || []).length) {
            const minR = parseInt(table.rollsMin, 10);
            const maxR = parseInt(table.rollsMax, 10);
            const a = isFinite(minR) && minR > 0 ? minR : 1;
            const b = isFinite(maxR) && maxR >= a ? maxR : a;
            const rolls = a + Math.floor(Math.random() * (b - a + 1));
            for (let i = 0; i < rolls; i++) take(this.pickWeighted(table.pool));
        }
        return out;
    }
};
