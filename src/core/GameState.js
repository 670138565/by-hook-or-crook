/* =====================================================================
 * 全局状态管理（GameState.js）
 * =====================================================================
 * 作用：存放"整个游戏期间都要共享的数据"，所有场景都能读写。
 *
 * 为什么需要它？举个例子：
 *   - 玩家金币数：主菜单要看、游戏场景要看、商店场景也要看
 *   - 如果每个场景各自存一份，容易打架、不同步
 *   - 统一放在 GameState 里，谁要用谁来这里取/存，数据只有一份，不会乱
 *
 * 通俗讲：像一个"全局存档箱"，玩家的金币、通缉等级、背包内容都存这里。
 *
 * 用法：
 *   读：GameState.get('金币')        → 返回当前金币数
 *   写：GameState.set('金币', 100)   → 设置金币为100
 *   改：GameState.add('金币', 10)    → 金币加10
 * ===================================================================== */
window.GameState = {
    // 内部数据存储（用对象存键值对）
    _data: {},

    // 读取某个值，不存在则返回默认值
    get(key, defaultValue = null) {
        if (key in this._data) {
            return this._data[key];
        }
        return defaultValue;
    },

    // 设置某个值
    set(key, value) {
        this._data[key] = value;
        // 数据变化时，通过事件总线喊一声，让关心这个数据的界面自动更新
        // 例如：金币变了，HUD 上的金币显示会自动刷新
        EventBus.emit('state:' + key, value);
    },

    // 数值类数据做加减（例如金币 +10）
    add(key, amount) {
        const current = this.get(key, 0);
        this.set(key, current + amount);
    },

    // ===== 背包格子相关 =====
    // 把"列,行"转成格子key字符串
    cellKey(col, row) { return col + ',' + row; },

    // 判断某格是否已解锁
    isCellUnlocked(col, row) {
        return this._data.backpackUnlocked.indexOf(this.cellKey(col, row)) >= 0;
    },

    // 解锁一格（如果已解锁就跳过）
    unlockCell(col, row) {
        const k = this.cellKey(col, row);
        if (this._data.backpackUnlocked.indexOf(k) < 0) {
            this._data.backpackUnlocked.push(k);
        }
    },

    // 初始化背包：拾取背包时调用，解锁初始格子
    initBackpack() {
        this._data.hasBackpack = true;
        this._data.backpackUnlocked = [];
        (CONFIG.BACKPACK.INITIAL_UNLOCK || []).forEach(c => this.unlockCell(c[0], c[1]));
        // 测试用：给几个扩展点。以后升级系统会改成升级发点
        this._data.backpackExpandPoints = CONFIG.BACKPACK.SEED_EXPAND_POINTS || 0;
        this._data.backpackStashSlots = CONFIG.BACKPACK.STASH_SLOTS_START || 0;
        // 测试物在捡到背包时就塞，开摊/按Tab都能看到，不用先开一次背包
        if (CONFIG.BACKPACK.SEED_TEST_ITEMS && (this.get('backpackItems') || []).length === 0 && window.ItemDB) {
            this.set('backpackItems', this.makeStarterBackpackItems());
        }
    },

    /** 开局测试物：只占已解锁的 4×3，互不重叠 */
    makeStarterBackpackItems() {
        if (!window.ItemDB) return [];
        return [
            ItemDB.createInstance('dagger', { col: 2, row: 1, placed: true, owner: 'backpack' }),
            ItemDB.createInstance('rage_potion', { col: 3, row: 1, placed: true, owner: 'backpack' }),
            ItemDB.createInstance('energy_potion', { col: 4, row: 1, placed: true, owner: 'backpack' }),
            ItemDB.createInstance('healing_potion', { col: 5, row: 1, placed: true, owner: 'backpack' }),
            ItemDB.createInstance('antidote', { col: 2, row: 2, placed: true, owner: 'backpack' }),
            ItemDB.createInstance('fake_key', { col: 3, row: 2, placed: true, owner: 'backpack' }),
            ItemDB.createInstance('torch', { col: 4, row: 2, placed: true, owner: 'backpack' }),
            ItemDB.createInstance('rye_bread', { col: 2, row: 3, placed: true, owner: 'backpack' })
        ].filter(Boolean);
    },

    // 成长：随身暂存 +n（有上限，避免又变成无限口袋）
    addStashSlots(n) {
        const max = CONFIG.BACKPACK.STASH_SLOTS_MAX || 3;
        const cur = this.get('backpackStashSlots', 0);
        this.set('backpackStashSlots', Math.min(max, cur + (n || 1)));
    },

    // 当前有几件还在格子外
    countLooseItems() {
        return this.get('backpackItems', []).filter(it => !this.isItemPlaced(it)).length;
    },

    // 升级/任务奖励时调用，给扩展点
    addExpandPoints(n) {
        this.add('backpackExpandPoints', n);
    },

    backpackGridSize() {
        const pack = (window.CONFIG && CONFIG.BACKPACK) || {};
        return {
            cols: pack.GRID_COLS || 9,
            rows: pack.GRID_ROWS || 5,
            total: (pack.GRID_COLS || 9) * (pack.GRID_ROWS || 5)
        };
    },

    /** 背包格子是否已全部解锁（满级判定） */
    isBackpackFullyUnlocked() {
        if (!this.get('hasBackpack', false)) return false;
        const { cols, rows, total } = this.backpackGridSize();
        const list = this.get('backpackUnlocked', []) || [];
        if (list.length < total) return false;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!this.isCellUnlocked(c, r)) return false;
            }
        }
        return true;
    },

    /** 扩展点已够铺满（或已全解锁）→ 不再升级 */
    isLevelCapped() {
        if (!this.get('hasBackpack', false)) return false;
        if (this.isBackpackFullyUnlocked()) return true;
        const { total } = this.backpackGridSize();
        const unlocked = (this.get('backpackUnlocked', []) || []).length;
        const pts = this.get('backpackExpandPoints', 0) || 0;
        return unlocked + pts >= total;
    },

    xpToNext() {
        if (this.isLevelCapped()) return 0;
        const lv = Math.max(1, this.get('等级', 1) || 1);
        const cfg = (window.CONFIG && CONFIG.LEVEL) || {};
        const base = parseInt(cfg.XP_BASE, 10);
        const step = parseInt(cfg.XP_STEP, 10);
        const b = isFinite(base) ? base : 14;
        const s = isFinite(step) ? step : 2;
        return Math.max(1, b + (lv - 1) * s);
    },

    gainXp(n) {
        const add = parseInt(n, 10) || 0;
        if (add <= 0) return { xp: 0, levels: [] };
        if (this.isLevelCapped()) {
            return { xp: 0, levels: [], capped: true };
        }
        this.set('经验', (this.get('经验', 0) || 0) + add);
        const hpGain = (window.CONFIG && CONFIG.LEVEL && CONFIG.LEVEL.HP) || 5;
        const expand = (window.CONFIG && CONFIG.LEVEL && CONFIG.LEVEL.EXPAND) || 1;
        const levels = [];
        let guard = 0;
        while ((this.get('经验', 0) || 0) >= this.xpToNext() && guard++ < 40) {
            if (this.isLevelCapped()) {
                this.set('经验', 0);
                break;
            }
            this.set('经验', this.get('经验', 0) - this.xpToNext());
            const lv = (this.get('等级', 1) || 1) + 1;
            this.set('等级', lv);
            this.set('生命上限', (this.get('生命上限', 30) || 30) + hpGain);
            this.heal(hpGain);
            this.addExpandPoints(expand);
            const sp = parseInt((window.CONFIG && CONFIG.LEVEL && CONFIG.LEVEL.SKILL_POINT_PER_LEVEL), 10);
            this.addSkillPoints(isFinite(sp) ? sp : 1);
            levels.push(lv);
            if (this.isLevelCapped()) {
                this.set('经验', 0);
                break;
            }
        }
        if (levels.length && window.QuestDB && QuestDB.pushNotice) {
            const expandN = expand;
            levels.forEach(lv => {
                const tip = this.isLevelCapped() && lv === levels[levels.length - 1]
                    ? ('升级！达到 ' + lv + ' 级——扩展点已够铺满背包，不再升级')
                    : ('升级！达到 ' + lv + ' 级（生命+、扩展点 +' + expandN + '、技能点 +1）');
                QuestDB.pushNotice(tip);
            });
        }
        return { xp: add, levels: levels };
    },

    /** 搜箱子时按品质给经验 */
    searchXpFor(it) {
        const q = (window.ItemDB && ItemDB.qualityOf) ? ItemDB.qualityOf(it) : 1;
        const table = (window.CONFIG && CONFIG.LEVEL && CONFIG.LEVEL.SEARCH_XP) || [0, 2, 3, 5, 8, 12];
        const i = Math.max(1, Math.min(5, q || 1));
        return parseInt(table[i], 10) || i;
    },

    /** 交任务默认经验（可被 rewards.xp 覆盖） */
    questXpReward(quest) {
        const r = (quest && quest.rewards) || {};
        const custom = parseInt(r.xp, 10);
        if (isFinite(custom) && custom >= 0) return custom;
        const cfg = (window.CONFIG && CONFIG.LEVEL) || {};
        const base = parseInt(cfg.QUEST_XP_BASE, 10);
        const per = parseInt(cfg.QUEST_XP_PER_GOAL, 10);
        const n = ((quest && quest.goals) || []).length || 1;
        return Math.max(0, (isFinite(base) ? base : 10) + n * (isFinite(per) ? per : 3));
    },

    // 判断某格是否与已解锁格上下左右相邻（对角线不算）
    isAdjacentToUnlocked(col, row) {
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (let i = 0; i < dirs.length; i++) {
            if (this.isCellUnlocked(col + dirs[i][0], row + dirs[i][1])) return true;
        }
        return false;
    },

    // 尝试解锁一格：消耗1点扩展点。返回 {ok, reason}
    // reason: already / nopoints / notadj / out
    tryUnlockCell(col, row, cols, rows) {
        if (col < 0 || row < 0 || col >= cols || row >= rows) return { ok: false, reason: 'out' };
        if (this.isCellUnlocked(col, row)) return { ok: false, reason: 'already' };
        if (this.get('backpackExpandPoints', 0) <= 0) return { ok: false, reason: 'nopoints' };
        if (!this.isAdjacentToUnlocked(col, row)) return { ok: false, reason: 'notadj' };
        this.unlockCell(col, row);
        this.add('backpackExpandPoints', -1);
        if (this.isBackpackFullyUnlocked()) {
            this.set('经验', 0);
            if (window.QuestDB && QuestDB.pushNotice) {
                QuestDB.pushNotice('背包已全部解锁——满级，不再升级');
            }
        }
        return { ok: true };
    },

    // 初始化默认数据（游戏开始时调用一次）
    init() {
        this._data = {
            金币: CONFIG.START_GOLD != null ? CONFIG.START_GOLD : 0,
            通缉等级: 0,          // 0=没通缉，1/2/3=通缉等级
            开锁器: CONFIG.START_LOCKPICKS != null ? CONFIG.START_LOCKPICKS : 3,
            开锁技能: 0,           // 兼容旧读法；以「属性.开锁」为准
            技能点: CONFIG.START_SKILL_POINTS != null ? CONFIG.START_SKILL_POINTS : 3,
            属性: { 开锁: 0, 潜行: 0, 口才: 0, 销赃: 0 },
            lockpickRegenAcc: 0,   // 累计走图时间，满 2 分钟送开锁器
            等级: 1,
            经验: 0,
            生命上限: CONFIG.MAX_HP != null ? CONFIG.MAX_HP : 30,
            生命: Math.min(
                CONFIG.START_HP != null ? CONFIG.START_HP : 30,
                CONFIG.MAX_HP != null ? CONFIG.MAX_HP : 30
            ),
            背包物品: [],         // 背包里的物品列表（后面背包系统会用）
            当前场景: '新手村',  // 玩家当前在哪个地点
            // ---- 背包系统数据 ----
            hasBackpack: false,   // 是否已拾取背包（拾取前Tab打不开）
            // 已解锁的格子：存 "列,行" 字符串数组，方便查重
            backpackUnlocked: [],
            // 已放入背包的物品：
            // {id, image, name, w, h, col, row, rot, rarity, placed, looseOX, looseOY, data}
            // placed=false 表示暂时放在格子外；关闭背包时掉地上或进容器
            backpackItems: [],
            // 扩展点：升级时获得，用于解锁新格子
            backpackExpandPoints: 0,
            // 地上掉落物（按地图 key 存，切图回来还能捡）
            groundDrops: {},
            // 容器库存：{ 容器id: { name, items: [] } }
            containers: {},
            // 箱子运行时：是否开着、该不该重抽、上次开锁的游戏时间
            chestStates: {},
            // 全游戏只出过一次的独特物代号
            uniqueGranted: {},
            // 游戏已运行毫秒（走图才走，开背包/开锁时场景暂停就不加）
            gameTime: 0,
            // 随身暂存格数：0=捡了必须立刻开背包；成长后可先带几件再整理
            backpackStashSlots: 0,
            // 商店运行时：{ id: { money, items, refreshedAt } }
            shops: {},
            quests: {},
            flags: {},
            visitedMaps: {},
            enteredZones: {},
            openedChests: {},
            killed: {},
            pickedMapItems: {},
            npcSickUntil: {},
            timedBuffs: [],
            引导完成: false
        };
        this._checkpoint = null;
        this._checkpointPos = null;
        this._pendingGroundLoot = [];
        this._lastLootLine = '';
    },

    /** 限时状态：伤害 / 潜行 / 可疑度等，到期自动消失（实时毫秒） */
    pruneTimedBuffs() {
        const list = this.get('timedBuffs', []) || [];
        const now = Date.now();
        const keep = list.filter(b => b && isFinite(b.until) && b.until > now);
        if (keep.length !== list.length) this.set('timedBuffs', keep);
        return keep;
    },

    /**
     * @param {{ id?: string, name?: string, ms?: number, stealth?: number, suspicion?: number, damage?: number }} spec
     */
    addTimedBuff(spec) {
        if (!spec) return null;
        const ms = Math.max(0, parseInt(spec.ms, 10) || 0);
        if (!ms) return null;
        const list = (this.pruneTimedBuffs() || []).slice();
        const id = String(spec.id || ('buff_' + Date.now()));
        const next = list.filter(b => b && b.id !== id);
        const buff = {
            id: id,
            name: String(spec.name || '状态'),
            until: Date.now() + ms,
            stealth: parseInt(spec.stealth, 10) || 0,
            suspicion: parseInt(spec.suspicion, 10) || 0,
            damage: parseInt(spec.damage, 10) || 0
        };
        next.push(buff);
        this.set('timedBuffs', next);
        return buff;
    },

    timedBuffMods() {
        const sum = { stealth: 0, suspicion: 0, damage: 0 };
        (this.pruneTimedBuffs() || []).forEach(b => {
            sum.stealth += parseInt(b.stealth, 10) || 0;
            sum.suspicion += parseInt(b.suspicion, 10) || 0;
            sum.damage += parseInt(b.damage, 10) || 0;
        });
        return sum;
    },

    /** 装备加成 + 限时状态 */
    liveOutStats() {
        const sum = this.wornOutStats();
        const b = this.timedBuffMods();
        sum.stealth += b.stealth || 0;
        sum.suspicion += b.suspicion || 0;
        sum.speech += 0;
        sum.noiseCut += 0;
        sum.fence += 0;
        return sum;
    },

    timedBuffLines() {
        const list = this.pruneTimedBuffs() || [];
        if (!list.length) return [];
        const now = Date.now();
        return list.map(b => {
            const left = Math.max(0, Math.ceil((b.until - now) / 1000));
            const m = Math.floor(left / 60);
            const s = left % 60;
            const clock = m + ':' + (s < 10 ? '0' : '') + s;
            const bits = [];
            if (b.damage) bits.push('伤' + (b.damage > 0 ? '+' : '') + b.damage);
            if (b.suspicion) bits.push('疑' + (b.suspicion > 0 ? '+' : '') + b.suspicion);
            if (b.stealth) bits.push('潜' + (b.stealth > 0 ? '+' : '') + b.stealth);
            const mods = bits.length ? ('  ' + bits.join(' ')) : '';
            return (b.name || '状态') + '  ' + clock + mods;
        });
    },

    timedBuffHud() {
        return (this.timedBuffLines() || []).join('\n');
    },

    backpackOcc() {
        const map = {};
        (this.get('backpackItems', []) || []).forEach(it => {
            if (!this.isItemPlaced(it) || (it.owner || 'backpack') !== 'backpack') return;
            const cells = window.ItemDB && ItemDB.worldCells ? ItemDB.worldCells(it) : [];
            cells.forEach(p => { map[p.c + ',' + p.r] = 1; });
        });
        return map;
    },

    itemFitsUnlocked(it, col, row, occ) {
        const cells = window.ItemDB && ItemDB.cellsOf ? ItemDB.cellsOf(it) : [{ c: 0, r: 0 }];
        for (let i = 0; i < cells.length; i++) {
            const c = col + cells[i].c;
            const r = row + cells[i].r;
            if (!this.isCellUnlocked(c, r)) return false;
            if (occ[c + ',' + r]) return false;
        }
        return true;
    },

    tryPlaceBackpackItem(it) {
        if (!it) return false;
        const pack = (window.CONFIG && CONFIG.BACKPACK) || {};
        const cols = pack.GRID_COLS || 9;
        const rows = pack.GRID_ROWS || 5;
        const occ = this.backpackOcc();
        const startRot = it.rot || 0;
        for (let k = 0; k < 4; k++) {
            it.rot = (startRot + k) % 4;
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    if (!this.itemFitsUnlocked(it, c, r, occ)) continue;
                    it.col = c;
                    it.row = r;
                    it.placed = true;
                    it.owner = 'backpack';
                    const items = this.get('backpackItems', []);
                    items.push(it);
                    this.set('backpackItems', items);
                    return true;
                }
            }
        }
        it.rot = startRot;
        return false;
    },

    giveLootDefs(defs) {
        const names = [];
        const ground = [];
        (defs || []).forEach(d => {
            if (!d || !d.defId) return;
            if (window.ItemDB && ItemDB.isLockpickResource(d.defId)) {
                this.gainLockpicks(ItemDB.lockpickAmount(d.defId));
                names.push('开锁器');
                return;
            }
            let inst = null;
            if (window.LootDB && LootDB.makeInst) inst = LootDB.makeInst(d.defId, d.unique);
            else if (window.ItemDB) inst = ItemDB.createInstance(d.defId, { owner: 'backpack', placed: true });
            if (!inst) return;
            inst.owner = 'backpack';
            if (d.unique && this.markUniqueGranted) this.markUniqueGranted(d.defId);
            if (this.tryPlaceBackpackItem(inst)) names.push(inst.name);
            else {
                inst.placed = false;
                inst.col = -1;
                inst.row = -1;
                inst.owner = 'backpack';
                ground.push(inst);
                names.push(inst.name);
            }
        });
        return { names: names, ground: ground };
    },

    setPendingGroundLoot(arr) {
        this._pendingGroundLoot = arr || [];
    },
    appendPendingGroundLoot(arr) {
        if (!arr || !arr.length) return;
        this._pendingGroundLoot = (this._pendingGroundLoot || []).concat(arr);
    },
    takePendingGroundLoot() {
        const a = this._pendingGroundLoot || [];
        this._pendingGroundLoot = [];
        return a;
    },

    saveCheckpoint(mapKey, x, y) {
        try {
            this._checkpoint = JSON.parse(JSON.stringify(this._data));
            this._checkpointPos = {
                mapKey: mapKey,
                x: Math.round(x),
                y: Math.round(y)
            };
        } catch (e) {
            this._checkpoint = null;
            this._checkpointPos = null;
        }
    },
    hasCheckpoint() {
        return !!this._checkpoint;
    },
    restoreCheckpoint() {
        if (!this._checkpoint) return null;
        const wanted = this._data.通缉等级 || 0;
        this._data = JSON.parse(JSON.stringify(this._checkpoint));
        this._data.通缉等级 = wanted;
        this._pendingGroundLoot = [];
        return this._checkpointPos
            ? { mapKey: this._checkpointPos.mapKey, x: this._checkpointPos.x, y: this._checkpointPos.y }
            : null;
    },

    getShop(sid) {
        if (!this._data.shops) this._data.shops = {};
        return this._data.shops[sid] || null;
    },

    setShop(sid, state) {
        if (!this._data.shops) this._data.shops = {};
        this._data.shops[sid] = state;
        return state;
    },

    addGameTime(ms) {
        const n = Number(ms);
        if (!isFinite(n) || n <= 0) return;
        this._data.gameTime = (this._data.gameTime || 0) + n;
        const interval = (window.CONFIG && CONFIG.LOCKPICK_REGEN_MS) || 120000;
        let acc = this._data.lockpickRegenAcc || 0;
        acc += n;
        let gained = 0;
        while (acc >= interval) {
            acc -= interval;
            this.gainLockpicks(1);
            gained++;
        }
        this._data.lockpickRegenAcc = acc;
        if (gained > 0 && window.QuestDB && QuestDB.pushNotice) {
            QuestDB.pushNotice(gained === 1 ? '摸出一把开锁器 +1' : ('摸出开锁器 +' + gained));
        }
    },

    gameTime() {
        return this._data.gameTime || 0;
    },

    getAttrs() {
        const blank = { 开锁: 0, 潜行: 0, 口才: 0, 销赃: 0 };
        const a = this.get('属性', null);
        if (!a || typeof a !== 'object') {
            blank.开锁 = this.get('开锁技能', 0) || 0;
            return blank;
        }
        const out = {};
        Object.keys(blank).forEach(k => {
            out[k] = parseInt(a[k], 10) || 0;
        });
        return out;
    },

    setAttr(key, val) {
        const a = this.getAttrs();
        if (!Object.prototype.hasOwnProperty.call(a, key)) return a;
        a[key] = Math.max(0, parseInt(val, 10) || 0);
        this.set('属性', a);
        if (key === '开锁') this.set('开锁技能', a.开锁);
        return a;
    },

    addSkillPoints(n) {
        const add = parseInt(n, 10) || 0;
        if (add === 0) return this.get('技能点', 0) || 0;
        this.add('技能点', add);
        return this.get('技能点', 0) || 0;
    },

    /** 花 1 技能点把某项基础属性 +1 */
    spendSkillPoint(key) {
        const pts = this.get('技能点', 0) || 0;
        if (pts <= 0) return { ok: false, reason: 'nopoints' };
        const a = this.getAttrs();
        if (!Object.prototype.hasOwnProperty.call(a, key)) return { ok: false, reason: 'badkey' };
        a[key] = (a[key] || 0) + 1;
        this.set('属性', a);
        this.set('技能点', pts - 1);
        if (key === '开锁') this.set('开锁技能', a.开锁);
        return { ok: true, attrs: a, left: pts - 1 };
    },

    /** 装备带来的开锁加成（不含基础属性） */
    lockpickItemBonus() {
        let n = 0;
        const items = this.get('backpackItems', []) || [];
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (!this.isItemPlaced(it) || it.owner !== 'backpack') continue;
            const def = window.ItemDB && it.defId ? ItemDB.get(it.defId) : null;
            const effects = def && def.combat && def.combat.effects;
            if (!effects) continue;
            for (let j = 0; j < effects.length; j++) {
                const e = effects[j];
                if (e && e.type === 'lockpick_skill') n += parseInt(e.value, 10) || 1;
            }
        }
        return Math.max(0, n);
    },

    hasItemDef(defId) {
        if (!defId) return false;
        const hit = (arr) => (arr || []).some(it => it && it.defId === defId);
        if (hit(this.get('backpackItems', []))) return true;
        const cons = this._data.containers || {};
        const cids = Object.keys(cons);
        for (let i = 0; i < cids.length; i++) {
            if (hit(cons[cids[i]] && cons[cids[i]].items)) return true;
        }
        const drops = this._data.groundDrops || {};
        const maps = Object.keys(drops);
        for (let i = 0; i < maps.length; i++) {
            if (hit(drops[maps[i]])) return true;
        }
        return false;
    },

    markUniqueGranted(defId) {
        if (!defId) return;
        if (!this._data.uniqueGranted) this._data.uniqueGranted = {};
        this._data.uniqueGranted[defId] = true;
    },

    wasUniqueGranted(defId) {
        return !!(this._data.uniqueGranted && this._data.uniqueGranted[defId]);
    },

    uniqueCtx() {
        const self = this;
        return {
            granted: this._data.uniqueGranted || {},
            hasDef: function (id) { return self.wasUniqueGranted(id) || self.hasItemDef(id); },
            grant: function (id) { self.markUniqueGranted(id); }
        };
    },

    getChestState(cid) {
        if (!this._data.chestStates) this._data.chestStates = {};
        return this._data.chestStates[cid] || null;
    },

    setChestState(cid, patch) {
        if (!this._data.chestStates) this._data.chestStates = {};
        const cur = this._data.chestStates[cid] || {};
        const next = {};
        Object.keys(cur).forEach(k => { next[k] = cur[k]; });
        Object.keys(patch || {}).forEach(k => { next[k] = patch[k]; });
        this._data.chestStates[cid] = next;
        return next;
    },

    // 穿在身上的：可穿戴物 + 已放进「背包」格子（箱子里、格子外都不算）
    isWorn(it) {
        return !!(it && this.isItemPlaced(it) && it.owner === 'backpack'
            && window.ItemDB && ItemDB.isWearable(it));
    },
    listWorn() {
        return this.get('backpackItems', []).filter(it => this.isWorn(it));
    },

    parseOutLine(s) {
        const r = { stealth: 0, noiseCut: 0, speech: 0, suspicion: 0, fence: 0 };
        if (!s) return r;
        String(s).replace(/潜行\s*([+-]?\d+)/g, (_, n) => {
            r.stealth += parseInt(n, 10) || 0;
            return _;
        });
        String(s).replace(/口才\s*([+-]?\d+)/g, (_, n) => {
            r.speech += parseInt(n, 10) || 0;
            return _;
        });
        String(s).replace(/可疑度\s*([+-]?\d+)/g, (_, n) => {
            r.suspicion += parseInt(n, 10) || 0;
            return _;
        });
        String(s).replace(/噪音\s*-\s*(\d+)\s*%/g, (_, n) => {
            r.noiseCut += parseInt(n, 10) || 0;
            return _;
        });
        String(s).replace(/销赃\s*\+\s*(\d+)\s*%/g, (_, n) => {
            r.fence += parseInt(n, 10) || 0;
            return _;
        });
        return r;
    },

    wornOutStats() {
        const sum = { stealth: 0, noiseCut: 0, speech: 0, suspicion: 0, fence: 0 };
        this.listWorn().forEach(it => {
            const def = window.ItemDB && it.defId ? ItemDB.get(it.defId) : null;
            const p = this.parseOutLine(def && def.out);
            sum.stealth += p.stealth;
            sum.noiseCut += p.noiseCut;
            sum.speech += p.speech;
            sum.suspicion += p.suspicion;
            sum.fence += p.fence;
        });
        return sum;
    },

    noiseRadius(lockLevel) {
        const st = (window.CONFIG && CONFIG.STEAL) || {};
        const lv = Math.max(1, parseInt(lockLevel, 10) || 1);
        let r = (st.NOISE_RADIUS || 320) + (lv - 1) * (st.NOISE_PER_LOCK || 50);
        const o = this.liveOutStats ? this.liveOutStats() : this.wornOutStats();
        const stealth = (this.getAttrs().潜行 || 0) + (o.stealth || 0);
        const wanted = this.wanted();
        const m = 1 - (o.noiseCut || 0) / 100
            - stealth * ((st.NOISE_STEALTH_PCT || 8) / 100)
            + (o.suspicion || 0) * ((st.NOISE_STEALTH_PCT || 8) / 100)
            + wanted * ((st.NOISE_WANTED_PCT || 12) / 100);
        r *= Math.max(0.35, Math.min(2.2, m));
        r *= this.nightNoticeMul();
        return r;
    },

    spotRange() {
        const st = (window.CONFIG && CONFIG.STEAL) || {};
        const base = st.SPOT_RANGE || 110;
        const o = this.liveOutStats ? this.liveOutStats() : this.wornOutStats();
        const stealth = (this.getAttrs().潜行 || 0) + (o.stealth || 0);
        const wanted = this.wanted();
        const wp = st.SPOT_WANTED_PCT != null ? st.SPOT_WANTED_PCT : 0.12;
        let r = Math.max(70, base * (1 + (o.suspicion || 0) * 0.06 + wanted * wp - stealth * 0.04));
        r *= this.nightNoticeMul();
        return r;
    },

    /** 口才判定用：基础口才 + 装备 − 可疑度 − 通缉 */
    speechScore() {
        const o = this.liveOutStats ? this.liveOutStats() : this.wornOutStats();
        return (this.getAttrs().口才 || 0) + (o.speech || 0) - (o.suspicion || 0) - this.wanted();
    },

    /** 对不认识的人用的化名。没起过，就叫行商。 */
    coverName() {
        const n = String(this.get('化名', '') || '').trim();
        return n || '行商';
    },

    wanted() {
        return this.get('通缉等级', 0) || 0;
    },

    wantedMax() {
        return (window.CONFIG && CONFIG.WANTED_MAX) || 3;
    },

    addWanted(n) {
        const add = parseInt(n, 10);
        if (!isFinite(add) || add === 0) {
            const cur = this.wanted();
            return { before: cur, after: cur, added: 0 };
        }
        const before = this.wanted();
        const after = Math.max(0, Math.min(this.wantedMax(), before + add));
        this.set('通缉等级', after);
        return { before: before, after: after, added: after - before };
    },

    /** 伏法档位表：罚款 + 限时减益（按通缉 1～3） */
    surrenderTable() {
        return {
            1: {
                gold: 50,
                name: '枷号余罪',
                ms: 3 * 60 * 1000,
                stealth: -15,
                suspicion: 10,
                damage: -5
            },
            2: {
                gold: 120,
                name: '游街示众',
                ms: 5 * 60 * 1000,
                stealth: -30,
                suspicion: 25,
                damage: -15
            },
            3: {
                gold: 250,
                name: '重枷示众',
                ms: 8 * 60 * 1000,
                stealth: -50,
                suspicion: 40,
                damage: -25
            }
        };
    },

    clampSurrenderLevel(level) {
        const n = parseInt(level, 10);
        if (!isFinite(n) || n < 1) return 1;
        return Math.min(3, n);
    },

    /** 主动伏法：按当前通缉，至少 1 级 */
    surrenderLevelVoluntary() {
        return this.clampSurrenderLevel(this.wanted() || 1);
    },

    /**
     * 被打败伏法：守卫战按通缉；非守卫 NPC 一律按 1 级
     * @param {boolean} authorityFight 是否守卫/抓捕方
     */
    surrenderLevelForDefeat(authorityFight) {
        if (!authorityFight) return 1;
        return this.clampSurrenderLevel(this.wanted() || 1);
    },

    /**
     * 伏法：扣罚款、挂 DEBUFF、清通缉、保底回血。钱不够则抄光。
     * @returns {{ level: number, paid: number, fine: number, short: boolean, buffName: string, toast: string }}
     */
    applySurrender(level) {
        const lv = this.clampSurrenderLevel(level);
        const spec = (this.surrenderTable()[lv] || this.surrenderTable()[1]);
        const gold = this.get('金币', 0) || 0;
        const paid = Math.min(gold, spec.gold);
        if (paid) this.add('金币', -paid);
        this.addTimedBuff({
            id: 'surrender_mark',
            name: spec.name,
            ms: spec.ms,
            stealth: spec.stealth,
            suspicion: spec.suspicion,
            damage: spec.damage
        });
        const beforeWanted = this.wanted();
        if (beforeWanted) this.set('通缉等级', 0);
        const maxHp = this.get('生命上限', 1) || 1;
        const floor = Math.max(1, Math.ceil(maxHp * 0.3));
        if ((this.get('生命', 0) || 0) < floor) this.set('生命', floor);
        const short = paid < spec.gold;
        let toast = window.t('gs.finePaid', '伏法（' + lv + '级）：罚 ' + paid + ' 格罗申', { l: lv, n: paid });
        if (short) toast += '（应罚 ' + spec.gold + '，钱不够全抄了）';
        toast += '，得「' + spec.name + '」';
        if (beforeWanted) toast += '，通缉清除';
        toast += '。';
        return {
            level: lv,
            paid: paid,
            fine: spec.gold,
            short: short,
            buffName: spec.name,
            toast: toast
        };
    },

    timeCfg() {
        return (window.CONFIG && CONFIG.TIME) || {};
    },

    dayLength() {
        return this.timeCfg().DAY_MS || (12 * 60 * 1000);
    },

    daylightLength() {
        return this.timeCfg().DAYLIGHT_MS || (8 * 60 * 1000);
    },

    dayClock() {
        return this.gameTime() % this.dayLength();
    },

    dayIndex() {
        const len = this.dayLength();
        if (!len) return 0;
        return Math.floor(this.gameTime() / len);
    },

    isNight() {
        return this.dayClock() >= this.daylightLength();
    },

    dayPart() {
        return this.isNight() ? '夜里' : '白天';
    },

    fmtClock(ms) {
        const s = Math.max(0, Math.floor((ms || 0) / 1000));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return m + ':' + (r < 10 ? '0' : '') + r;
    },

    clockHud() {
        const t = this.dayClock();
        const day = this.daylightLength();
        const all = this.dayLength();
        if (t < day) return window.t('game.dayLeft', '白天 还剩 {t}', { t: this.fmtClock(day - t) });
        let s = window.t('game.nightLeft', '夜里 还剩 {t}', { t: this.fmtClock(all - t) });
        if (this.hasTorch()) s += window.t('game.torch', '（火把）');
        return s;
    },

    /** 0=大白天，1=完全夜里。天黑前一段会渐暗 */
    nightStrength() {
        const t = this.dayClock();
        const day = this.daylightLength();
        if (t >= day) return 1;
        const dusk = this.timeCfg().DUSK_MS != null ? this.timeCfg().DUSK_MS : 45000;
        if (dusk <= 0 || t < day - dusk) return 0;
        return (t - (day - dusk)) / dusk;
    },

    hasTorch() {
        if (!window.ItemDB || !ItemDB.hasCombatEffect) return false;
        return this.placedBagItems().some(it => ItemDB.hasCombatEffect(it, 'light'));
    },

    nightNoticeMul() {
        if (!this.isNight()) return 1;
        const t = this.timeCfg();
        if (this.hasTorch()) return t.NIGHT_TORCH != null ? t.NIGHT_TORCH : 1.25;
        return t.NIGHT_HIDE != null ? t.NIGHT_HIDE : 0.55;
    },

    makeNpcSick(npcId) {
        if (!npcId) return false;
        if (!this._data.npcSickUntil) this._data.npcSickUntil = {};
        this._data.npcSickUntil[npcId] = this.gameTime() + this.dayLength();
        return true;
    },

    isNpcSick(npcId) {
        if (!npcId || !this._data.npcSickUntil) return false;
        const until = this._data.npcSickUntil[npcId];
        return !!(until && this.gameTime() < until);
    },

    placedBagItems() {
        return (this.get('backpackItems', []) || []).filter(it =>
            this.isItemPlaced(it) && (it.owner || 'backpack') === 'backpack'
        );
    },

    usableKeys(lockLevel) {
        const lv = Math.max(1, parseInt(lockLevel, 10) || 1);
        const seen = {};
        const out = [];
        this.placedBagItems().forEach(it => {
            if (!it || !it.defId || seen[it.defId]) return;
            const e = window.ItemDB && ItemDB.lockKeyOf ? ItemDB.lockKeyOf(it) : null;
            if (!e) return;
            if (e.type === 'gold_chest_key' && lv !== 3) return;
            seen[it.defId] = 1;
            let label = it.name || '钥匙';
            if (e.type === 'fake_key') label += ' ' + (e.chance || 50) + '%';
            out.push({
                defId: it.defId,
                name: it.name,
                type: e.type,
                chance: e.chance || 50,
                label: label
            });
        });
        return out;
    },

    consumePlacedDef(defId) {
        if (!defId) return false;
        const items = (this.get('backpackItems', []) || []).slice();
        const i = items.findIndex(it =>
            it && it.defId === defId && this.isItemPlaced(it) && (it.owner || 'backpack') === 'backpack'
        );
        if (i < 0) return false;
        items.splice(i, 1);
        this.set('backpackItems', items);
        return true;
    },

    // 物品是否已经放进格子（没 placed 字段但有合法 col/row 也算已放置）
    isItemPlaced(it) {
        return it && it.placed !== false && it.col >= 0 && it.row >= 0;
    },

    hudText() {
        const max = this.get('生命上限', (window.CONFIG && CONFIG.MAX_HP) || 30);
        const xpLine = this.isBackpackFullyUnlocked()
            ? window.t('bag.maxLevel', '满级')
            : (this.isLevelCapped()
                ? window.t('bag.expFull', '经验已满 · 去解锁格子')
                : window.t('bag.expLine', '经验 {a}/{b}', { a: (this.get('经验', 0) || 0), b: this.xpToNext() }));
        const bits = [
            window.t('ui.hp', '生命') + ' ' + this.get('生命', 0) + '/' + max,
            window.t('ui.level', '等级') + ' ' + (this.get('等级', 1) || 1),
            xpLine,
            window.t('ui.gold', '格罗申 {v}', { v: this.get('金币', 0) }),
            window.t('ui.lockpick', '开锁器') + ' ' + this.get('开锁器', 0),
            window.t('attr.开锁', '开锁') + ' ' + this.lockpickSkill()
        ];
        if (this.get('技能点', 0)) bits.push(window.t('ui.skillPoints', '技能点') + ' ' + this.get('技能点', 0));
        if (this.wanted()) bits.push(window.t('ui.wanted', '通缉') + ' ' + this.wanted() + '/' + this.wantedMax());
        bits.push(this.clockHud ? this.clockHud() : this.dayPart());
        return bits.join('  ·  ');
    },

    isGuideDone() {
        try { return localStorage.getItem('dao_yi_you_dao_guide') === '1'; } catch (e) { return !!this.get('引导完成', false); }
    },

    markGuideDone() {
        this.set('引导完成', true);
        try { localStorage.setItem('dao_yi_you_dao_guide', '1'); } catch (e) { /* ignore */ }
    },

    clearGuideDone() {
        this.set('引导完成', false);
        try { localStorage.removeItem('dao_yi_you_dao_guide'); } catch (e) { /* ignore */ }
    },

    /** 基础开锁属性 + 已放进背包格子的物品加成（例如匕首开锁+1） */
    lockpickSkill() {
        return Math.max(0, (this.getAttrs().开锁 || 0) + this.lockpickItemBonus());
    },

    heal(n) {
        const max = this.get('生命上限', (window.CONFIG && CONFIG.MAX_HP) || 30);
        const before = this.get('生命', 0);
        const add = parseInt(n, 10);
        if (!isFinite(add) || add <= 0) return { before: before, after: before, gained: 0, max: max };
        const after = Math.min(max, before + add);
        this.set('生命', after);
        return { before: before, after: after, gained: after - before, max: max };
    },

    hurt(n) {
        const before = this.get('生命', 0);
        const sub = parseInt(n, 10);
        if (!isFinite(sub) || sub <= 0) return { before: before, after: before, lost: 0 };
        const after = Math.max(0, before - sub);
        this.set('生命', after);
        return { before: before, after: after, lost: before - after };
    },

    gainLockpicks(n) {
        const add = parseInt(n, 10);
        if (!isFinite(add) || add === 0) return this.get('开锁器', 0);
        this.add('开锁器', add);
        return this.get('开锁器', 0);
    },

    /** 从物品列表里抽出开锁器，加到资源上，返回剩下的（真正进格子的） */
    takeLockpicksOut(items) {
        const left = [];
        let gained = 0;
        (items || []).forEach(it => {
            if (window.ItemDB && ItemDB.isLockpickResource(it)) {
                gained += ItemDB.lockpickAmount(it);
            } else {
                left.push(it);
            }
        });
        if (gained) this.gainLockpicks(gained);
        return { items: left, gained: gained };
    },

    // 往背包加一件物品（默认放格子外，打开背包再拖进去）
    // 开锁器不会进列表，直接加到「开锁器」资源
    addBackpackItem(partial) {
        if (window.ItemDB && ItemDB.isLockpickResource(partial)) {
            this.gainLockpicks(ItemDB.lockpickAmount(partial));
            return null;
        }
        const items = this.get('backpackItems', []);
        let inst = null;
        if (partial.defId && window.ItemDB) {
            inst = ItemDB.createInstance(partial.defId, {
                id: partial.id,
                rot: partial.rot,
                data: partial.data,
                poisoned: !!partial.poisoned
            });
        }
        if (!inst) {
            inst = {
                id: partial.id || ('i' + Date.now() + '_' + items.length),
                defId: partial.defId || '',
                image: partial.image,
                name: partial.name || '物品',
                w: partial.w || 1,
                h: partial.h || 1,
                rot: partial.rot || 0,
                rarity: partial.rarity || 'common',
                data: partial.data || {}
            };
        }
        if (partial.poisoned) inst.poisoned = true;
        inst.col = -1;
        inst.row = -1;
        inst.placed = false;
        inst.owner = 'backpack';
        inst.looseOX = 90 + items.length * 20;
        inst.looseOY = -70;
        items.push(inst);
        this.set('backpackItems', items);
    },

    // 地上掉落
    addGroundDrop(mapKey, item) {
        if (!this._data.groundDrops[mapKey]) this._data.groundDrops[mapKey] = [];
        this._data.groundDrops[mapKey].push(item);
    },
    getGroundDrops(mapKey) {
        return (this._data.groundDrops[mapKey] || []).slice();
    },
    removeGroundDrop(mapKey, id) {
        const arr = this._data.groundDrops[mapKey];
        if (!arr) return;
        this._data.groundDrops[mapKey] = arr.filter(i => i.id !== id);
    },

    ensureContainer(containerId, name) {
        if (!this._data.containers[containerId]) {
            this._data.containers[containerId] = { name: name || '容器', items: [] };
        }
    },
    getContainerItems(containerId) {
        const c = this._data.containers[containerId];
        return c && c.items ? c.items : [];
    },
    setContainerItems(containerId, name, items) {
        this.ensureContainer(containerId, name);
        this._data.containers[containerId].name = name || this._data.containers[containerId].name;
        this._data.containers[containerId].items = items || [];
    },

    // 格子外的物品放回容器（关闭背包且正在和容器交互时）
    stashToContainer(containerId, name, items) {
        this.ensureContainer(containerId, name);
        this._data.containers[containerId].name = name || this._data.containers[containerId].name;
        this._data.containers[containerId].items.push.apply(this._data.containers[containerId].items, items);
    },

    hasItemInBag(defId) {
        if (!defId) return false;
        return (this.get('backpackItems', []) || []).some(it => it && it.defId === defId);
    },

    takeOneFromBag(defId) {
        if (!defId) return null;
        const items = (this.get('backpackItems', []) || []).slice();
        let i = items.findIndex(it => it && it.defId === defId && it.poisoned);
        if (i < 0) i = items.findIndex(it => it && it.defId === defId);
        if (i < 0) return null;
        const it = items[i];
        items.splice(i, 1);
        this.set('backpackItems', items);
        return it;
    },

    removeOneFromBag(defId) {
        return !!this.takeOneFromBag(defId);
    },

    _markSet(key, id) {
        if (!id) return;
        if (!this._data[key] || typeof this._data[key] !== 'object') this._data[key] = {};
        this._data[key][id] = true;
    },
    _hasSet(key, id) {
        return !!(id && this._data[key] && this._data[key][id]);
    },

    setFlag(name) { this._markSet('flags', name); if (window.EventBus) EventBus.emit('quest:changed', { flag: name }); },
    hasFlag(name) { return this._hasSet('flags', name); },
    markVisitedMap(k) { this._markSet('visitedMaps', k); },
    markPickedMapItem(mapKey, id) {
        if (!mapKey || !id) return;
        this._markSet('pickedMapItems', mapKey + ':' + id);
    },
    isPickedMapItem(mapKey, id) {
        return this._hasSet('pickedMapItems', mapKey + ':' + id);
    },
    hasVisitedMap(k) { return this._hasSet('visitedMaps', k); },
    markEnteredZone(k) { this._markSet('enteredZones', k); },
    hasEnteredZone(k) { return this._hasSet('enteredZones', k); },
    markOpenedChest(k) { this._markSet('openedChests', k); },
    hasOpenedChest(k) { return this._hasSet('openedChests', k); },
    markKilled(id) { this._markSet('killed', id); if (window.EventBus) EventBus.emit('quest:changed', { killed: id }); },
    hasKilled(id) { return this._hasSet('killed', id); }
};
