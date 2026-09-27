/* =====================================================================
 * 任务（QuestDB.js）
 * 任务写在各 NPC 的 quests 里（npcs.json）。状态存在 GameState。
 * 未接 / 进行中 / 已完成。目标 8 种：物品、谈过、标记、钱、开箱、地图、剧情区、击杀。
 * ===================================================================== */
window.QuestDB = {
    notices: [],

    all() {
        const out = [];
        const npcs = (window.DialogueDB && DialogueDB.npcs) || [];
        npcs.forEach(n => {
            (n && n.quests || []).forEach(q => {
                if (q && q.id) out.push(q);
            });
        });
        return out;
    },

    get(id) {
        if (!id) return null;
        return this.all().find(q => q.id === id) || null;
    },

    state(id) {
        if (!id || !window.GameState) return '';
        const bag = GameState.get('quests', null) || {};
        return bag[id] || '';
    },

    setState(id, s) {
        if (!id || !window.GameState) return;
        const bag = Object.assign({}, GameState.get('quests', null) || {});
        if (!s) delete bag[id];
        else bag[id] = s;
        GameState.set('quests', bag);
        if (window.EventBus) EventBus.emit('quest:changed', { id: id, state: s });
    },

    isNone(id) { return this.state(id) === ''; },
    isActive(id) { return this.state(id) === 'active'; },
    isDone(id) { return this.state(id) === 'done'; },

    hudLine() {
        const block = this.hudBlock();
        if (!block) return '';
        return block.split('\n')[0] || '';
    },

    /** 进行中的任务名 + 目标（多行，右上角 HUD） */
    hudBlock() {
        const list = this.all().filter(q => this.isActive(q.id)).slice(0, 3);
        if (!list.length) return '';
        const lines = [];
        list.forEach((q, i) => {
            if (i) lines.push('');
            lines.push('任务：' + (q.name || q.id));
            const goals = q.goals || [];
            if (!goals.length) {
                lines.push('· 按对话推进');
                return;
            }
            goals.forEach(g => {
                const ok = this.goalMet(g);
                lines.push((ok ? '✓ ' : '· ') + this.goalText(g));
            });
        });
        if (this.all().filter(q => this.isActive(q.id)).length > 3) lines.push('…');
        return lines.join('\n');
    },

    goalText(goal) {
        if (!goal) return '目标';
        const t = goal.type || 'item';
        if (t === 'item') {
            const id = goal.itemId || goal.value || '';
            const def = window.ItemDB && id ? ItemDB.get(id) : null;
            const name = (def && def.name) || id || '物品';
            return (goal.consume === false ? '展示：' : '取得：') + name;
        }
        if (t === 'talked') {
            let id = goal.npcId || goal.value || '';
            if (window.DialogueDB && DialogueDB.resolveNpcRef) id = DialogueDB.resolveNpcRef(id, null);
            const n = window.DialogueDB && id ? DialogueDB.get(id) : null;
            const label = (n && n.name) || (String(goal.npcId || '').charAt(0) === '@'
                ? String(goal.npcId).slice(1) : id) || '某人';
            return '与' + label + '交谈';
        }
        if (t === 'flag') {
            const f = goal.flag || goal.value || '';
            return '完成：' + f;
        }
        if (t === 'gold') return window.t('quest.goldGoal', '格罗申 ≥ {n}', { n: (parseInt(goal.amount || goal.value, 10) || 0) });
        if (t === 'chest') return '打开木箱';
        if (t === 'map') return '前往：' + (goal.mapKey || goal.value || '某地');
        if (t === 'zone') return '进入：' + (goal.zoneKey || goal.value || '剧情区');
        if (t === 'kill') {
            const id = goal.npcId || goal.value || '';
            const n = window.DialogueDB && id ? DialogueDB.get(id) : null;
            return '击败：' + ((n && n.name) || id || '敌人');
        }
        return '推进任务';
    },

    pushNotice(msg) {
        if (msg) this.notices.push(msg);
    },

    takeNotices() {
        const n = this.notices.slice();
        this.notices = [];
        return n;
    },

    goalMet(goal) {
        if (!goal || !window.GameState) return false;
        const t = goal.type || 'item';
        if (t === 'item') return GameState.hasItemInBag(goal.itemId || goal.value);
        if (t === 'talked') {
            let id = goal.npcId || goal.value || '';
            if (window.DialogueDB && DialogueDB.resolveNpcRef) id = DialogueDB.resolveNpcRef(id, null);
            return !!GameState.get('talked:' + id, false);
        }
        if (t === 'flag') return GameState.hasFlag(goal.flag || goal.value);
        if (t === 'gold') return (GameState.get('金币', 0) || 0) >= (parseInt(goal.amount || goal.value, 10) || 0);
        if (t === 'chest') return GameState.hasOpenedChest(goal.chestId || goal.value);
        if (t === 'map') return GameState.hasVisitedMap(goal.mapKey || goal.value);
        if (t === 'zone') return GameState.hasEnteredZone(goal.zoneKey || goal.value);
        if (t === 'kill') {
            let id = goal.npcId || goal.value || '';
            if (window.DialogueDB && DialogueDB.resolveNpcRef) id = DialogueDB.resolveNpcRef(id, null);
            return GameState.hasKilled(id);
        }
        return false;
    },

    goalsMet(quest) {
        const q = typeof quest === 'string' ? this.get(quest) : quest;
        if (!q) return false;
        const goals = q.goals || [];
        if (!goals.length) return true;
        return goals.every(g => this.goalMet(g));
    },

    accept(id) {
        const q = this.get(id);
        if (!q) return { ok: false, msg: '' };
        const st = this.state(id);
        if (st === 'done') return { ok: false, already: true, msg: '' };
        if (st === 'active') return { ok: true, already: true, msg: '' };
        this.setState(id, 'active');
        const granted = this.grantQuestItems(q.grants || q.onAccept, '接任务');
        let msg = '接了任务：' + (q.name || q.id);
        if (granted.length) msg += '  获得：' + granted.join('、');
        this.pushNotice(msg);
        return { ok: true, msg: msg, items: granted };
    },

    complete(id) {
        const q = this.get(id);
        if (!q) return { ok: false, msg: '' };
        if (this.isDone(id)) return { ok: false, already: true, msg: '' };
        if (!this.isActive(id)) return { ok: false, msg: '' };
        if (!this.goalsMet(q)) return { ok: false, msg: '' };
        const consume = (q.goals || []).filter(g => g && g.type === 'item' && g.consume !== false && (g.itemId || g.value));
        for (let i = 0; i < consume.length; i++) {
            if (!GameState.hasItemInBag(consume[i].itemId || consume[i].value)) {
                return { ok: false, msg: '' };
            }
        }
        let poisoned = false;
        consume.forEach(g => {
            const it = GameState.takeOneFromBag
                ? GameState.takeOneFromBag(g.itemId || g.value)
                : (GameState.removeOneFromBag(g.itemId || g.value), null);
            if (it && it.poisoned) poisoned = true;
        });
        if (poisoned) {
            const who = this.ownerNpc(id);
            if (who && who.id && GameState.makeNpcSick) GameState.makeNpcSick(who.id);
        }
        const r = q.rewards || {};
        const gold = parseInt(r.gold, 10) || 0;
        const picks = parseInt(r.lockpicks, 10) || 0;
        const pts = parseInt(r.expandPoints, 10) || 0;
        const xp = (window.GameState && GameState.questXpReward)
            ? GameState.questXpReward(q)
            : (parseInt(r.xp, 10) || 0);
        if (gold) GameState.add('金币', gold);
        if (picks) GameState.gainLockpicks(picks);
        if (pts) GameState.addExpandPoints(pts);
        let grew = { xp: 0, levels: [] };
        if (xp > 0 && GameState.gainXp) grew = GameState.gainXp(xp);
        const itemNames = this.grantQuestItems(r, '奖励');
        this.setState(id, 'done');
        let msg = '完成任务：' + (q.name || q.id);
        if (gold) msg += window.t('quest.goldReward', '  格罗申 +{n}', { n: gold });
        if (picks) msg += '  开锁器 +' + picks;
        if (grew.xp) msg += '  经验 +' + grew.xp;
        if (itemNames.length) msg += '  物品：' + itemNames.join('、');
        if (poisoned) msg += '  他吃了有毒的食物，病倒了';
        this.pushNotice(msg);
        if (id === 'q_demo_decide') {
            this.pushNotice('主线告一段落——游戏不会结束，清溪区还能继续逛、做支线。');
        }
        return { ok: true, msg: msg };
    },

    /**
     * 发物品：接任务 grants / 交任务 rewards 共用。
     * 写法：{ items: [{ itemId, count }] } 或 { itemId, itemCount }
     */
    grantQuestItems(spec, tip) {
        if (!spec || !window.GameState || !GameState.giveLootDefs) return [];
        const defs = [];
        const push = (id, n) => {
            const defId = String(id || '').trim();
            if (!defId) return;
            const count = Math.max(1, parseInt(n, 10) || 1);
            for (let i = 0; i < count; i++) defs.push({ defId: defId });
        };
        if (Array.isArray(spec)) {
            spec.forEach(row => pushRow(row));
        } else {
            if (Array.isArray(spec.items)) spec.items.forEach(row => pushRow(row));
            else if (spec.items && typeof spec.items === 'object') pushRow(spec.items);
            if (spec.itemId) push(spec.itemId, spec.itemCount || 1);
        }
        function pushRow(row) {
            if (!row) return;
            // PowerShell 有时会把单元素数组再包一层
            if (Array.isArray(row)) { row.forEach(pushRow); return; }
            if (typeof row === 'string') push(row, 1);
            else push(row.itemId || row.defId || row.id, row.count || row.amount || 1);
        }
        if (!defs.length) return [];
        const given = GameState.giveLootDefs(defs);
        const loose = given.ground || [];
        if (loose.length) {
            if (GameState.appendPendingGroundLoot) GameState.appendPendingGroundLoot(loose);
            this.pushNotice('背包放不下，有东西掉在脚边');
        }
        return given.names || [];
    },

    /** @deprecated 用 grantQuestItems */
    grantRewardItems(r) {
        return this.grantQuestItems(r, '奖励');
    },

    ownerNpc(questId) {
        if (!questId) return null;
        const npcs = (window.DialogueDB && DialogueDB.npcs) || [];
        for (let i = 0; i < npcs.length; i++) {
            const n = npcs[i];
            if ((n && n.quests || []).some(q => q && q.id === questId)) return n;
        }
        return null;
    },

    markZone(zoneData) {
        if (!zoneData || !window.GameState) return;
        if (zoneData.id) GameState.markEnteredZone(zoneData.id);
        if (zoneData.name) GameState.markEnteredZone(zoneData.name);
    },

    markChest(itemData, containerId) {
        if (!window.GameState) return;
        if (itemData && itemData.id) GameState.markOpenedChest(itemData.id);
        if (itemData && itemData.name) GameState.markOpenedChest(itemData.name);
        if (containerId) GameState.markOpenedChest(containerId);
    }
};
