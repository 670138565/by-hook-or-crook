/* =====================================================================
 * 商店图鉴（ShopDB.js）
 * 读 shop.json。收购比例、老板本金、刷新秒数都可以在表里改，
 * 不填则用 CONFIG.SHOP。砍价幅度以后会乘玩家属性和声望。
 * ===================================================================== */
window.ShopDB = {
    shops: [],
    byId: {},

    async load() {
        try {
            const res = await fetch('assets/configs/shop.json?t=' + Date.now());
            const json = await res.json();
            this.shops = json.shops || [];
            this.byId = {};
            this.shops.forEach(s => { if (s && s.id) this.byId[s.id] = s; });
        } catch (e) {
            console.warn('ShopDB: 读 shop.json 失败', e);
            this.shops = [];
            this.byId = {};
        }
    },

    get(id) {
        return this.byId[id] || null;
    },

    defaultShop() {
        return this.shops[0] || null;
    },

    shopFor(itemData) {
        const id = itemData && itemData.shopId;
        if (id && this.byId[id]) return this.byId[id];
        return this.defaultShop();
    },

    instanceId(mapKey, itemData) {
        const id = (itemData && (itemData.id || itemData.name)) || 'shop';
        return (mapKey || 'map') + ':' + id;
    },

    cfg() {
        return (window.CONFIG && CONFIG.SHOP) || {};
    },

    buyRate(def) {
        const n = def && def.buyRate;
        if (n != null && isFinite(n)) return n;
        const c = this.cfg().BUY_RATE;
        return c != null ? c : 0.5;
    },

    sellRate(def) {
        const n = def && def.sellRate;
        if (n != null && isFinite(n)) return n;
        const c = this.cfg().SELL_RATE;
        return c != null ? c : 1;
    },

    /** 0.1 = 公平价两侧各 10%。口才拉开幅度 */
    bargainRange(def) {
        const n = def && def.bargainRange;
        let r = (n != null && isFinite(n)) ? n
            : (this.cfg().BARGAIN_RANGE != null ? this.cfg().BARGAIN_RANGE : 0.1);
        const p = this.playerTrade();
        r *= (1 + (p.speech || 0) * 0.05);
        return r;
    },

    playerTrade() {
        const worn = (window.GameState && GameState.liveOutStats)
            ? GameState.liveOutStats()
            : ((window.GameState && GameState.wornOutStats)
                ? GameState.wornOutStats()
                : { speech: 0, suspicion: 0, fence: 0 });
        const a = (window.GameState && GameState.getAttrs) ? GameState.getAttrs() : {};
        const fencePer = (window.CONFIG && CONFIG.ATTR_FENCE_PCT) || 5;
        return {
            speech: (a.口才 || 0) + (worn.speech || 0),
            suspicion: worn.suspicion || 0,
            fence: (a.销赃 || 0) * fencePer + (worn.fence || 0)
        };
    },

    startMoney(def) {
        const n = def && def.money;
        if (n != null && isFinite(n)) return Math.max(0, n);
        return this.cfg().DEFAULT_MONEY != null ? this.cfg().DEFAULT_MONEY : 80;
    },

    /** 铁匠愿加价收的金属赃物 */
    METAL_LOOT: {
        rusty_nail: true,
        candlestick: true,
        silver_cross: true,
        iron_plate: true,
        gold_goblet: true,
        golden_chalice: true,
        royal_crest: true
    },

    dayIndex() {
        if (window.GameState && GameState.dayIndex) return GameState.dayIndex();
        return 0;
    },

    /** day 白天 / dusk 黄昏 / evening 入夜 / late 深夜 */
    phase() {
        if (!window.GameState || !GameState.dayClock) return 'day';
        const t = GameState.dayClock();
        const day = GameState.daylightLength();
        const all = GameState.dayLength();
        const dusk = (GameState.timeCfg && GameState.timeCfg().DUSK_MS) || 0;
        const late = day + Math.max(0, all - day) / 2;
        if (t >= late) return 'late';
        if (t >= day) return 'evening';
        if (dusk > 0 && t >= day - dusk) return 'dusk';
        return 'day';
    },

    isOpen(def) {
        if (!def || !def.hours) return true;
        const p = this.phase();
        if (def.hours === 'day') return p === 'day' || p === 'dusk';
        if (def.hours === 'evening') return p !== 'day';
        if (def.hours === 'late') return p === 'late';
        return true;
    },

    closedText(def) {
        const name = (def && def.name) || '这家店';
        const h = def && def.hours;
        if (h === 'day') return name + '天黑了就上门';
        if (h === 'evening') return name + '傍晚才开门';
        if (h === 'late') return name + '要到深夜才开门';
        return '现在没开门';
    },

    usesDaily(def) {
        return !!(def && def.daily);
    },

    refreshSeconds(def) {
        const n = def && def.refreshSeconds;
        if (n != null && isFinite(n) && n > 0) return n;
        return this.cfg().REFRESH_SECONDS || 300;
    },

    itemWorth(it) {
        if (!it) return 0;
        if (it.worth != null && isFinite(it.worth)) return Math.max(0, it.worth);
        const def = window.ItemDB && ItemDB.get(it.defId);
        return def && def.worth != null ? Math.max(0, def.worth) : 0;
    },

    takePrice(it, shopDef) {
        if (it && it.data && it.data.shopPrice != null && isFinite(it.data.shopPrice)) {
            return Math.max(0, it.data.shopPrice);
        }
        return Math.round(this.itemWorth(it) * this.sellRate(shopDef));
    },

    prefOf(it, shopDef) {
        if (!it || !shopDef) return null;
        const id = it.defId || it.id;
        const list = shopDef.buyPrefs || [];
        for (let i = 0; i < list.length; i++) {
            if (list[i] && list[i].itemId === id) return list[i];
        }
        const bonus = parseFloat(shopDef.metalBonus);
        if (bonus && this.METAL_LOOT[id]) return { bonus: bonus };
        return null;
    },

    givePrice(it, shopDef) {
        const worth = this.itemWorth(it);
        const pref = this.prefOf(it, shopDef);
        let n;
        if (pref && pref.price != null && isFinite(pref.price)) n = pref.price;
        else if (pref && pref.bonus) n = Math.round(worth * (1 + pref.bonus));
        else n = Math.round(worth * this.buyRate(shopDef));
        const p = this.playerTrade();
        n = Math.round(n * (1 + (p.fence || 0) / 100));
        return Math.max(0, n);
    },

    canSell(it) {
        if (!it) return false;
        if (it.data && (it.data.unique || it.data.keepOnRefresh)) return false;
        const e = window.ItemDB && ItemDB.effectOf(it);
        if (e && (e.type === 'quest' || e.type === 'key')) return false;
        return true;
    },

    /** 差价 = 你要拿的售价 − 你拿出的收购价。>0 你掏钱，<0 你收钱 */
    quote(giveItems, takeItems, shopDef) {
        let give = 0, take = 0;
        (giveItems || []).forEach(it => { give += this.givePrice(it, shopDef); });
        (takeItems || []).forEach(it => { take += this.takePrice(it, shopDef); });
        return { give: give, take: take, diff: take - give };
    },

    /**
     * slider: -1 对你有利（少给/多得），+1 对老板有利（多给/少得），0 公平
     * 返回 { pay, receive } 都是非负数
     */
    settle(diff, slider, shopDef) {
        const range = this.bargainRange(shopDef);
        const s = Math.max(-1, Math.min(1, slider || 0));
        let pay = 0, receive = 0;
        if (diff > 0) {
            pay = Math.max(0, Math.round(diff * (1 + s * range)));
        } else if (diff < 0) {
            receive = Math.max(0, Math.round((-diff) * (1 - s * range)));
        }
        return { pay: pay, receive: receive };
    },

    buildStock(shopDef) {
        const cols = (shopDef && shopDef.shelfCols) || this.cfg().SHELF_COLS || 6;
        const rows = (shopDef && shopDef.shelfRows) || this.cfg().SHELF_ROWS || 6;
        const occ = window.LootDB ? LootDB.emptyGrid(cols, rows) : null;
        const items = [];
        ((shopDef && shopDef.stock) || []).forEach(row => {
            if (row && row.kind === 'lockpick' && row.infinite) return;
            const n = Math.max(1, parseInt(row.count, 10) || 1);
            for (let i = 0; i < n; i++) {
                let inst = null;
                if (row.kind === 'lockpick' || (row.itemId && ItemDB.isLockpickResource(row.itemId))) {
                    inst = ItemDB.createInstance('lockpick', {
                        owner: 'shelf',
                        placed: true,
                        data: { shopPrice: row.price != null ? row.price : 15, isShopLockpick: true }
                    });
                } else if (row.itemId) {
                    inst = ItemDB.createInstance(row.itemId, {
                        owner: 'shelf',
                        placed: true,
                        data: { shopPrice: row.price }
                    });
                }
                if (!inst) continue;
                if (occ && LootDB.tryPlaceInst(occ, inst, cols, rows)) {
                    inst.owner = 'shelf';
                    items.push(inst);
                } else if (!occ) {
                    inst.col = items.length % cols;
                    inst.row = Math.floor(items.length / cols);
                    items.push(inst);
                }
            }
        });
        return items;
    },

    isDue(state, shopDef, now) {
        if (!state) return true;
        const sec = this.refreshSeconds(shopDef);
        if (sec <= 0) return false;
        return (now - (state.refreshedAt || 0)) >= sec * 1000;
    },

    refreshState(shopDef) {
        return {
            money: this.startMoney(shopDef),
            items: this.buildStock(shopDef),
            refreshedAt: window.GameState ? GameState.gameTime() : 0,
            dayIndex: this.dayIndex(),
            turnover: 0
        };
    },

    ensure(mapKey, itemData) {
        const def = this.shopFor(itemData);
        const sid = this.instanceId(mapKey, itemData);
        if (!def) return { id: sid, def: null, state: null };
        let st = GameState.getShop(sid);
        if (this.usesDaily(def)) {
            const day = this.dayIndex();
            if (!st || st.dayIndex !== day) {
                const fresh = this.refreshState(def);
                if (st && st.dayIndex != null) {
                    const turn = st.turnover || 0;
                    const rate = def.cashRecover != null && isFinite(def.cashRecover) ? def.cashRecover : 0.6;
                    fresh.money = turn > 0 ? Math.round(turn * rate) : this.startMoney(def);
                }
                fresh.dayIndex = day;
                fresh.turnover = 0;
                st = fresh;
                GameState.setShop(sid, st);
            }
        } else if (!st || this.isDue(st, def, GameState.gameTime())) {
            st = this.refreshState(def);
            GameState.setShop(sid, st);
        }
        return { id: sid, def: def, state: st };
    }
};
