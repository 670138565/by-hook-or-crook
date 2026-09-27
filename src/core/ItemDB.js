/* =====================================================================
 * 道具图鉴（ItemDB.js）
 * =====================================================================
 * 作用：读 items.json，给全游戏提供「这种道具长什么样、占几格」。
 *
 * 两层数据（记住这句就行）：
 *   图鉴 = 一种道具的规则（只存一份）
 *   实例 = 背包/箱子/地上的「这一件」（由 createInstance 生成）
 *
 * ---- 你怎么加一种新道具 ----
 *   1. 把图片放到 assets/images/items/（例如 bread.png）
 *      注意：地图上的木箱/装饰是「摆件」，图放 assets/images/props/，不要和这里混
 *   2. 打开 assets/configs/items.json，照着已有的抄一条
 *   3. 改 id / type / name / desc / worth / image / w / h / rarity
 * type = 物品类型（像文件夹：服装、工具、赃物… 在物品编辑器里建）
 * shape = 可选，h 行 × w 列的 0/1 表。1=占这格，0=空。没有 shape 就是整块矩形。
 *   4. 刷新游戏（图会自动加载，不用改代码）
 *
 * desc  = 物品描述（给玩家看的一两句话）
 * worth = 价值（格罗申；商店买卖、销赃用。任务关键物可填 0）
 *
 * rarity 只能填：common / rare / epic / legendary / artifact（对应品质 1–5 绿蓝紫黄红）
 * quality = 1–5，有则优先
 * combat = 战斗用数字（energy / dmg / shield / heal / inCombat / effects）
 * mechanic / out = 给人看的说明；out 世界属性以后再算
 * use = none（不能用）/ consume（点一下用掉）/ key / equip
 * effect.type = heal（回血）/ add_lockpick / equip / sell / quest / key
 * ===================================================================== */
window.ItemDB = {
    items: {},   // id → 定义
    list: [],    // 全部定义（有序列表）
    QUALITY_RARITY: ['', 'common', 'rare', 'epic', 'legendary', 'artifact'],

    async load() {
        try {
            const res = await fetch('assets/configs/items.json?t=' + Date.now());
            const json = await res.json();
            this.list = json.items || [];
            this.types = json.types || [];
            this.items = {};
            this.list.forEach(def => { this.items[def.id] = def; });
            this.list.forEach(def => this.ensureCombatFields(def));
        } catch (e) {
            console.warn('ItemDB: 读 items.json 失败', e);
            this.list = [];
            this.items = {};
        }
    },

    /** 按代号取图鉴。没有这种道具就返回 null */
    get(id) {
        return this.items[id] || null;
    },

    /** 开锁器：箱子里当物品显示，拖到左边才加成数字资源 */
    isLockpickResource(itOrDefId) {
        const def = typeof itOrDefId === 'string'
            ? this.get(itOrDefId)
            : (itOrDefId && itOrDefId.defId ? this.get(itOrDefId.defId)
                : (itOrDefId && itOrDefId.effect ? itOrDefId : this.get(itOrDefId && itOrDefId.id)));
        return !!(def && def.effect && def.effect.type === 'add_lockpick');
    },

    lockpickAmount(itOrDefId) {
        const def = typeof itOrDefId === 'string'
            ? this.get(itOrDefId)
            : (itOrDefId && itOrDefId.defId ? this.get(itOrDefId.defId)
                : (itOrDefId && itOrDefId.effect ? itOrDefId : this.get(itOrDefId && itOrDefId.id)));
        if (!def || !def.effect || def.effect.type !== 'add_lockpick') return 0;
        const n = parseInt(def.effect.value, 10);
        return isFinite(n) && n > 0 ? n : 1;
    },

    /** 图鉴上的效果（heal / equip / sell …） */
    effectOf(itOrDefId) {
        const def = typeof itOrDefId === 'string'
            ? this.get(itOrDefId)
            : (itOrDefId && itOrDefId.defId ? this.get(itOrDefId.defId)
                : (itOrDefId && itOrDefId.effect ? itOrDefId : this.get(itOrDefId && itOrDefId.id)));
        return (def && def.effect) || null;
    },

    /** 衣服/武器等：放进背包格子 = 穿上，不用点使用 */
    isWearable(itOrDefId) {
        const def = typeof itOrDefId === 'string'
            ? this.get(itOrDefId)
            : (itOrDefId && itOrDefId.defId ? this.get(itOrDefId.defId) : itOrDefId);
        return !!(def && def.effect && def.effect.type === 'equip');
    },

    ensureCombatFields(def) {
        if (!def) return;
        const q = parseInt(def.quality, 10);
        if (q >= 1 && q <= 5 && this.QUALITY_RARITY[q]) def.rarity = this.QUALITY_RARITY[q];
    },

    combatOf(itOrDefId) {
        const def = typeof itOrDefId === 'string'
            ? this.get(itOrDefId)
            : (itOrDefId && itOrDefId.defId ? this.get(itOrDefId.defId) : itOrDefId);
        return (def && def.combat) || null;
    },

    /**
     * 生成一件实例（放进背包/箱子/地上时用）
     * extra 可覆盖：col, row, rot, placed, owner, id, looseOX, looseOY
     */
    createInstance(defId, extra) {
        extra = extra || {};
        const def = this.get(defId);
        if (!def) {
            console.warn('ItemDB: 没有这种道具', defId);
            return null;
        }
        return {
            id: extra.id || ('inst_' + Date.now() + '_' + Math.floor(Math.random() * 10000)),
            defId: def.id,
            type: def.type || '未分类',
            image: def.image,
            name: def.name,
            desc: def.desc || '',
            worth: def.worth != null ? def.worth : 0,
            w: def.w,
            h: def.h,
            shape: def.shape ? def.shape.map(row => row.slice()) : null,
            rarity: def.rarity || 'common',
            rot: extra.rot || 0,
            col: extra.col != null ? extra.col : -1,
            row: extra.row != null ? extra.row : -1,
            placed: extra.placed === true,
            owner: extra.owner || 'backpack',
            poisoned: !!extra.poisoned,
            looseOX: extra.looseOX,
            looseOY: extra.looseOY,
            data: extra.data || {}
        };
    },

    /** 没有 shape 或全是 1：整块矩形 */
    normalizeShape(w, h, shape) {
        const rows = Math.max(1, h || 1), cols = Math.max(1, w || 1);
        const out = [];
        for (let r = 0; r < rows; r++) {
            out[r] = [];
            for (let c = 0; c < cols; c++) {
                if (!shape) out[r][c] = 1;
                else out[r][c] = (shape[r] && shape[r][c]) ? 1 : 0;
            }
        }
        if (shape && !out.some(row => row.some(v => v))) {
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[r][c] = 1;
        }
        return out;
    },

    /** 顺时针转 90° × rot 次。shape[行][列] */
    rotateShape(shape, rot) {
        let s = shape;
        const n = ((rot % 4) + 4) % 4;
        for (let i = 0; i < n; i++) {
            const h = s.length, w = s[0].length;
            const next = [];
            for (let c = 0; c < w; c++) {
                next[c] = [];
                for (let r = 0; r < h; r++) next[c][h - 1 - r] = s[r][c];
            }
            s = next;
        }
        return s;
    },

    /** 当前朝向下，相对物品左上角要占的格子 {c,r}[] */
    cellsOf(it) {
        const w = it.w || 1, h = it.h || 1;
        const s = this.rotateShape(this.normalizeShape(w, h, it.shape), it.rot || 0);
        const cells = [];
        for (let r = 0; r < s.length; r++) {
            for (let c = 0; c < s[r].length; c++) {
                if (s[r][c]) cells.push({ c: c, r: r });
            }
        }
        return cells;
    },

    worldCells(it) {
        return this.cellsOf(it).map(p => ({ c: (it.col || 0) + p.c, r: (it.row || 0) + p.r }));
    },

    defOf(it) {
        if (!it) return null;
        if (it.defId) return this.get(it.defId);
        if (it.id && this.items[it.id]) return this.get(it.id);
        return it;
    },

    qualityOf(itOrDef) {
        const def = this.defOf(itOrDef) || itOrDef;
        const q = parseInt(def && def.quality, 10);
        if (q >= 1 && q <= 5) return q;
        const map = { common: 1, rare: 2, epic: 3, legendary: 4, artifact: 5 };
        return map[(def && def.rarity) || ''] || 1;
    },

    combatEffects(itOrDef) {
        const c = this.combatOf(itOrDef);
        return (c && c.effects) || [];
    },

    hasCombatEffect(itOrDef, type) {
        return this.combatEffects(itOrDef).some(e => e && e.type === type);
    },

    isFood(itOrDef) {
        const def = typeof itOrDef === 'string' ? this.get(itOrDef) : this.defOf(itOrDef);
        return !!(def && (def.cat === 'food' || def.type === '食物'));
    },

    isPoisonVial(itOrDef) {
        return this.hasCombatEffect(itOrDef, 'next_poison');
    },

    displayName(it) {
        const def = this.defOf(it) || {};
        const n = (it && it.name) || def.name || window.t('tip.unknown', '物品');
        const localized = (def.id && window.t) ? window.t('item.' + def.id + '.name', n) : n;
        if (it && it.poisoned) return window.t('tip.poisonedPrefix', '有毒的') + localized;
        return localized;
    },

    /** 悬停提示用的多行说明 */
    tooltipLines(it) {
        if (!it) return ['……'];
        const def = this.defOf(it) || {};
        const id = def.id || '';
        const k = (suffix) => (id ? 'item.' + id + suffix : null);
        const lines = [];
        lines.push(this.displayName(it));
        const type = it.type || def.type || '';
        const rarity = it.rarity || def.rarity || '';
        const rarityLoc = rarity ? window.t('rarity.' + rarity, rarity) : '';
        const typeLoc = type ? window.t('type.' + type, type) : '';
        if (typeLoc || rarityLoc) {
            lines.push([typeLoc, rarityLoc].filter(Boolean).join(' · '));
        }
        const worth = it.worth != null ? it.worth : def.worth;
        if (worth != null && worth !== '') lines.push(window.t('tip.worth', '价值：{v} 格罗申', { v: worth }));
        const q = this.qualityOf(it);
        if (q > 1) lines.push(window.t('tip.quality', '品质：{q}/5', { q }));
        const wh = (it.w || def.w || 1) + '×' + (it.h || def.h || 1);
        lines.push(window.t('tip.size', '占格：{s}', { s: wh }));
        const desc = (it.desc != null && it.desc !== '') ? it.desc : (def.desc || '');
        if (desc) lines.push(k('.desc') ? window.t(k('.desc'), desc) : desc);
        if (def.mechanic) lines.push(k('.mechanic') ? window.t(k('.mechanic'), def.mechanic) : def.mechanic);
        if (it.poisoned) lines.push(window.t('tip.status', '状态：{s}', { s: window.t('tip.poisoned', '已下毒') }));
        const fx = this.combatEffects(it);
        if (fx.length) {
            const bits = fx.map(e => this.effectTip(e)).filter(Boolean);
            if (bits.length) lines.push(window.t('tip.effect', '效果：{s}', { s: bits.join('、') }));
        }
        return lines;
    },

    tooltipText(it) {
        return this.tooltipLines(it).join('\n');
    },

    effectTip(e) {
        if (!e || !e.type) return '';
        const v = e.value != null ? e.value : '';
        const map = {
            lockpick_skill: () => window.t('fx.lockpick_skill', '开锁+{v}', { v: v || 1 }),
            next_poison: () => window.t('fx.next_poison', '可涂毒'),
            fake_key: () => window.t('fx.fake_key', '假钥匙'),
            master_key: () => window.t('fx.master_key', '万能钥匙'),
            gold_chest_key: () => window.t('fx.gold_chest_key', '金箱钥匙'),
            launcher: () => window.t('fx.launcher', '远程'),
            arrow: () => window.t('fx.arrow', '箭矢'),
            arrow_poison: () => window.t('fx.arrow_poison', '毒箭'),
            arrow_burn: () => window.t('fx.arrow_burn', '火箭'),
            heal: () => window.t('fx.heal', '恢复生命{v}', { v }),
            damage: () => window.t('fx.damage', '伤害{v}', { v })
        };
        if (map[e.type]) return map[e.type]();
        return e.type + (v !== '' ? (' ' + v) : '');
    },

    tintPoisoned(sprite, it) {
        if (!sprite) return;
        if (it && it.poisoned) sprite.setTint(0x4ad84a);
        else if (sprite.clearTint) sprite.clearTint();
    },

    lockKeyOf(itOrDef) {
        const fx = this.combatEffects(itOrDef);
        return fx.find(e => e && (e.type === 'fake_key' || e.type === 'master_key' || e.type === 'gold_chest_key')) || null;
    },

    isLauncher(itOrDef) {
        return this.hasCombatEffect(itOrDef, 'launcher');
    },

    isArrow(itOrDef) {
        const types = { arrow: 1, arrow_poison: 1, arrow_burn: 1 };
        return this.combatEffects(itOrDef).some(e => e && types[e.type]);
    },

    /** 飞刀/飞镖/油瓶/战斗药水：不耗能量，点一下用掉 */
    isCombatConsumable(itOrDef) {
        const def = this.defOf(itOrDef);
        const cbt = this.combatOf(itOrDef) || {};
        if (cbt.consume) return true;
        if (!def) return false;
        if (def.cat === 'food' || cbt.inCombat === false) return false;
        if (def.use === 'consume') return true;
        return def.type === '消耗品';
    },

    combatCat(itOrDef) {
        const def = this.defOf(itOrDef);
        if (def && def.cat) return def.cat;
        const slot = this.effectOf(itOrDef);
        if (slot && slot.type === 'equip') return slot.slot === 'body' ? 'armor' : (slot.slot || '');
        return '';
    },

    /** 旋转后的朝向：0右 1下 2左 3上。默认横放朝右。 */
    facing(it) {
        return (((it && it.rot) || 0) % 4 + 4) % 4;
    },

    facingDelta(face) {
        const d = [[1, 0], [0, 1], [-1, 0], [0, -1]];
        return d[((face % 4) + 4) % 4];
    },

    /** 弓弩相对自身的发射边：up/right/down/left，随 rot 转 */
    fireDir(it) {
        const fx = this.combatEffects(it).find(e => e && e.type === 'launcher') || {};
        const local = { right: 0, down: 1, left: 2, up: 3 };
        const add = local[fx.fire] != null ? local[fx.fire] : 0;
        return (this.facing(it) + add) % 4;
    },

    fireDirName(it) {
        const fx = this.combatEffects(it).find(e => e && e.type === 'launcher') || {};
        return ({
            up: window.t('fx.dir.up', '上方'),
            right: window.t('fx.dir.right', '右侧'),
            down: window.t('fx.dir.down', '下方'),
            left: window.t('fx.dir.left', '左侧')
        })[fx.fire] || window.t('fx.dir.any', '发射侧');
    },

    /** 发射一侧外侧那一列/行的格子（弓弩贴着箭用） */
    fireSideCells(it) {
        const d = this.facingDelta(this.fireDir(it));
        const cells = this.worldCells(it);
        const set = {};
        cells.forEach(p => { set[p.c + ',' + p.r] = 1; });
        const front = cells.filter(p => !set[(p.c + d[0]) + ',' + (p.r + d[1])]);
        return front.map(p => ({ c: p.c + d[0], r: p.r + d[1] }));
    },

    /**
     * 贴图等比塞进占格外框，不按格子比例拉扁。
     * 九宫格切出来的方图用在 2×1 / 1×3 物品上时也不会变形。
     */
    fitArt(it, cellSize, imgW, imgH, pad) {
        pad = pad == null ? 6 : pad;
        const boxW = Math.max(1, (it && it.w) || 1) * cellSize - pad;
        const boxH = Math.max(1, (it && it.h) || 1) * cellSize - pad;
        const iw = imgW || 0, ih = imgH || 0;
        if (iw < 1 || ih < 1) return { w: boxW, h: boxH };
        const s = Math.min(boxW / iw, boxH / ih);
        return { w: Math.max(1, Math.round(iw * s)), h: Math.max(1, Math.round(ih * s)) };
    },

    texSize(scene, it) {
        const key = (it && it.image && scene.textures.exists('item:' + it.image))
            ? ('item:' + it.image)
            : (scene.textures.exists('item:missing') ? 'item:missing' : '');
        if (!key) return { w: 0, h: 0 };
        const img = scene.textures.get(key).getSourceImage();
        return { w: (img && (img.naturalWidth || img.width)) || 0, h: (img && (img.naturalHeight || img.height)) || 0 };
    },

    /** 图鉴里用到的图片，给 PreloadScene 加载（背包/掉落用，和地图摆件分开） */
    collectImages() {
        const seen = {};
        const out = [];
        this.list.forEach(def => {
            if (!def.image || seen[def.image]) return;
            seen[def.image] = true;
            out.push({ key: 'item:' + def.image, path: 'assets/images/items/' + def.image });
        });
        return out;
    }
};
