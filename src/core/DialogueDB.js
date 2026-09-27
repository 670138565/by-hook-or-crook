/* =====================================================================
 * 对话 / NPC（DialogueDB.js）
 * 优先读 npcs.json（节点图）。没有则退回 dialogues.json。
 * 地图摆件 dialogueId = NPC id。
 * ===================================================================== */
window.DialogueDB = {
    list: [],
    byId: {},
    npcs: [],
    henry: { portrait: '', moods: [] },

    async load() {
        this.npcs = [];
        this.list = [];
        this.henry = { portrait: '', moods: [] };
        let json = null;
        try {
            const res = await fetch('/get-config?name=npc&t=' + Date.now(), { cache: 'no-store' });
            json = await res.json();
            if (json && json.npcs) this.npcs = json.npcs;
        } catch (e) { /* 旧服务器 */ }
        if (!this.npcs.length) {
            try {
                const res = await fetch('assets/configs/npcs.json?t=' + Date.now());
                json = await res.json();
                this.npcs = (json && json.npcs) || [];
            } catch (e2) { this.npcs = []; }
        }
        if (json && json.henry) this.henry = json.henry;
        if (!this.henry.moods) this.henry.moods = [];
        if (!this.npcs.length) {
            try {
                const res = await fetch('/get-config?name=dialogue&t=' + Date.now(), { cache: 'no-store' });
                const json = await res.json();
                this.list = (json && json.dialogues) || [];
            } catch (e) {
                try {
                    const res = await fetch('assets/configs/dialogues.json?t=' + Date.now());
                    const json = await res.json();
                    this.list = (json && json.dialogues) || [];
                } catch (e2) { this.list = []; }
            }
        }
        this.byId = {};
        this.npcs.forEach(n => { if (n && n.id) this.byId[n.id] = n; });
        this.list.forEach(d => { if (d && d.id && !this.byId[d.id]) this.byId[d.id] = d; });
    },

    collectImages() {
        const set = new Set();
        const take = (p) => {
            if (p && p.portrait) set.add(p.portrait);
            if (p && p.avatar) set.add(p.avatar);
            (p && p.moods || []).forEach(m => { if (m && m.file) set.add(m.file); });
        };
        this.npcs.forEach(take);
        take(this.henry);
        const out = [];
        set.forEach(fn => out.push({ key: 'npcport_' + fn, path: 'assets/images/npcs/' + fn }));
        return out;
    },

    moveOf(id) {
        const n = this.get(id);
        const m = (n && n.move) || {};
        let mode = m.mode || 'stand';
        if (mode !== 'wander' && mode !== 'pace' && mode !== 'path') mode = 'stand';
        return {
            mode: mode,
            axis: m.axis === 'y' ? 'y' : 'x',
            radius: Math.max(40, parseInt(m.radius, 10) || 160),
            dist: Math.max(40, parseInt(m.dist, 10) || 160),
            step: Math.max(0, parseInt(m.step, 10) || 0),
            pauseMs: Math.max(0, parseInt(m.pauseMs, 10) || 0),
            pauseJitter: Math.max(0, parseInt(m.pauseJitter, 10) || 0),
            hearLock: m.hearLock !== false,
            pickFood: m.pickFood !== false
        };
    },

    spriteOf(id) {
        const n = this.get(id);
        const s = n && n.sprites;
        if (!s || !s.walk) return null;
        const walkOnly = !s.idle || s.idle === s.walk;
        return {
            idleKey: walkOnly ? 'npcwalk_' + id : 'npcidle_' + id,
            walkKey: 'npcwalk_' + id,
            idleFile: s.idle || s.walk,
            walkFile: s.walk,
            cols: Math.max(1, parseInt(s.cols, 10) || 8),
            rows: Math.max(1, parseInt(s.rows, 10) || 5),
            idleFromWalk: walkOnly
        };
    },

    collectSpriteSheets() {
        const out = [];
        const seen = {};
        (this.npcs || []).forEach(n => {
            const s = this.spriteOf(n && n.id);
            if (!s) return;
            if (!s.idleFromWalk && s.idleFile && !seen[s.idleKey]) {
                seen[s.idleKey] = 1;
                out.push({ key: s.idleKey, path: 'assets/images/npcs/' + s.idleFile, kind: 'idle' });
            }
            if (!seen[s.walkKey]) {
                seen[s.walkKey] = 1;
                out.push({ key: s.walkKey, path: 'assets/images/npcs/' + s.walkFile, kind: 'walk' });
            }
        });
        return out;
    },

    portraitFile(person, moodId) {
        if (!person) return '';
        if (moodId && person.moods) {
            const m = person.moods.find(x => x.id === moodId);
            if (m && m.file) return m.file;
        }
        return person.portrait || '';
    },

    get(id) { return this.byId[id] || null; },

    isGuard(id) {
        const n = this.get(id);
        const s = ((n && n.identity) || '').trim();
        return s === '守卫' || s === '守卫队长' || s === '民兵' || s === '新兵' || s === '老兵';
    },

    guardKind(id) {
        const n = this.get(id);
        const s = ((n && n.identity) || '').trim();
        if (s === '守卫队长') return 'captain';
        return 'guard';
    },

    forItem(itemData) {
        const id = itemData && (itemData.npcId || itemData.dialogueId);
        if (id && this.byId[id]) return this.byId[id];
        if (this.npcs[0]) return this.npcs[0];
        return this.list[0] || null;
    },

    hasGraph(def) {
        return !!(def && def.graph && def.graph.nodes && def.graph.nodes.length);
    },

    /** 按 E 后能不能真正说到一句台词（空起点 / 断线会直接关掉） */
    hasSpeakable(def) {
        if (!def) return false;
        if (!this.hasGraph(def)) {
            return !!(def.nodes && def.nodes.some(n => n && ((n.text || '').trim() || n.type === 'choice')));
        }
        const start = this.graphStart(def);
        const node = this.skipSilent(def, start, true, false);
        if (!node) return false;
        if (node.type === 'end') return false;
        if (node.type === 'npc' || node.type === 'player' || node.type === 'choice' || node.type === 'battle') return true;
        return !!(node.text || '').trim();
    },

    findNode(def, id) {
        if (!def) return null;
        if (this.hasGraph(def)) return (def.graph.nodes || []).find(n => n.id === id) || null;
        return (def.nodes || []).find(n => n.id === id) || null;
    },

    graphStart(def) {
        if (!this.hasGraph(def)) {
            if (def && def.start) return this.findNode(def, def.start) || (def.nodes && def.nodes[0]) || null;
            return def && def.nodes && def.nodes[0] || null;
        }
        const s = def.graph.nodes.find(n => n.type === 'start');
        return this.follow(def, s, 'out') || s || def.graph.nodes[0];
    },

    follow(def, node, port) {
        if (!node) return null;
        if (this.hasGraph(def)) {
            const p = port || 'out';
            const c = (def.graph.connections || []).find(x => x.from === node.id && (x.port || 'out') === p);
            return c ? this.findNode(def, c.to) : null;
        }
        if (port && port !== 'out') return this.findNode(def, port);
        const idx = (def.nodes || []).indexOf(node);
        if (idx >= 0 && idx < def.nodes.length - 1) return def.nodes[idx + 1];
        return null;
    },

    /** @SELF → 当前 NPC id；@名字 → 按名字查 id。任务目标和谈过条件共用。 */
    resolveNpcRef(raw, selfDef) {
        const v = String(raw == null ? '' : raw).trim();
        if (!v) return '';
        if (v === '@SELF') return (selfDef && selfDef.id) || '';
        if (v.charAt(0) === '@') {
            const name = v.slice(1);
            const hit = (this.npcs || []).find(n => n && n.name === name);
            if (hit && hit.id) return hit.id;
            return v;
        }
        return v;
    },

    skipSilent(def, node, preview, apply) {
        const doApply = !!apply && !preview;
        let guard = 0;
        while (node && guard++ < 40) {
            if (node.type === 'start') { node = this.follow(def, node, 'out'); continue; }
            if (node.type === 'accept' || node.type === 'complete') {
                if (doApply && window.QuestDB && node.questId) {
                    if (node.type === 'accept') QuestDB.accept(node.questId);
                    else QuestDB.complete(node.questId);
                }
                node = this.follow(def, node, 'out');
                continue;
            }
            if (node.type === 'condition') {
                const ok = preview ? true : this.checkCondition(node, def);
                node = this.follow(def, node, ok ? 'yes' : 'no');
                continue;
            }
            if (node.type === 'end') return node;
            if (node.type === 'battle') return node;
            break;
        }
        return node;
    },

    checkCondition(node, def) {
        if (!window.GameState) return false;
        let v = node.condValue || '';
        const cond = node.cond || '';
        if (cond === 'talked' || cond === 'killed') v = this.resolveNpcRef(v, def);
        if (cond === 'hasGold') {
            return (GameState.get('金币', 0) || 0) >= (parseInt(v, 10) || 0);
        }
        if (cond === 'talked') {
            return !!GameState.get('talked:' + v, false);
        }
        if (cond === 'hasItem') {
            return GameState.hasItemInBag ? GameState.hasItemInBag(v) : false;
        }
        if (cond === 'hasFlag') return !!GameState.hasFlag(v);
        if (cond === 'questNone') return !window.QuestDB || QuestDB.isNone(v);
        if (cond === 'questActive') return !!(window.QuestDB && QuestDB.isActive(v));
        if (cond === 'questDone') return !!(window.QuestDB && QuestDB.isDone(v));
        if (cond === 'questGoals') return !!(window.QuestDB && QuestDB.isActive(v) && QuestDB.goalsMet(v));
        if (cond === 'chest') return !!GameState.hasOpenedChest(v);
        if (cond === 'map') return !!GameState.hasVisitedMap(v);
        if (cond === 'zone') return !!GameState.hasEnteredZone(v);
        if (cond === 'killed') return !!GameState.hasKilled(v);
        if (cond === 'speech') return this.speechCheck(v);
        return false;
    },

    speechCheck(dc) {
        const need = parseInt(dc, 10);
        const n = isFinite(need) ? need : 0;
        const score = (window.GameState && GameState.speechScore) ? GameState.speechScore() : 0;
        return score >= n;
    },

    /** 台词里的 {名} 换成玩家的化名。 */
    aliasText(s) {
        const name = (window.GameState && GameState.coverName) ? GameState.coverName() : window.t('npc.henry.name', '亨利');
        return String(s == null ? '' : s).replace(/\{名\}/g, name);
    },

    /** NPC 显示名：优先语言表（npc.<id>.name），缺了回退原文 */
    npcDisplayName(def, fallback) {
        const id = def && def.id;
        const n = (def && (def.speaker || def.name)) || fallback || window.t('npc.passerby.name', '路人');
        return id ? window.t('npc.' + id + '.name', n) : n;
    },

    speakInfo(def, node, preview) {
        if (!node) return { speaker: '', text: '……', choices: [], next: null, done: true, side: 'npc', portrait: '' };
        if (node.type === 'end') return { speaker: '', text: '', choices: [], next: null, done: true, side: 'npc', portrait: '', report: node.report || '' };
        const isHenry = node.type === 'player' || node.type === 'choice';
        const side = isHenry ? 'henry' : 'npc';
        const portrait = this.portraitFile(isHenry ? this.henry : def, node.mood);
        if (!this.hasGraph(def) && node.text) {
            const choices = (node.choices || []).filter(c => c && (c.text || '').trim()).map(c => ({
                text: c.text, next: this.findNode(def, c.next)
            }));
            return {
                speaker: node.speaker || this.npcDisplayName(def, '路人'),
                text: node.text,
                choices: choices,
                next: choices.length ? null : this.follow(def, node, ''),
                done: false,
                side: side,
                portrait: portrait
            };
        }
        if (node.type === 'battle') {
            const eid = (node.enemyId || def.id || '').trim();
            const enemy = this.get(eid) || def;
            const hp = parseInt(node.enemyHp, 10);
            const enemyHp = (isFinite(hp) && hp > 0) ? hp : 40;
            const foes = this.battleEnemies(node, def);
            const names = foes.map(e => e.name).join('、');
            if (preview) {
                return {
                    speaker: window.t('npc.combat.name', '战斗'),
                    text: '（进入战斗：' + names + '）',
                    choices: [
                        { text: '胜利', nextRaw: this.follow(def, node, 'win') },
                        { text: '失败', nextRaw: this.follow(def, node, 'lose') }
                    ],
                    next: null,
                    nextRaw: null,
                    done: false,
                    battle: true,
                    side: 'npc',
                    portrait: this.portraitFile(enemy || def, '')
                };
            }
            return {
                battle: true,
                enemyId: eid,
                enemyName: (foes[0] && foes[0].name) || names,
                enemyKind: (node.enemyKind || '').trim(),
                enemies: foes,
                enemyHp: enemyHp,
                winRaw: this.follow(def, node, 'win'),
                loseRaw: this.follow(def, node, 'lose'),
                speaker: '',
                text: '',
                choices: [],
                next: null,
                nextRaw: null,
                done: false,
                side: 'npc',
                portrait: this.portraitFile(enemy || def, '')
            };
        }
        const speaker = isHenry ? window.t('npc.henry.name', '亨利') : this.npcDisplayName(def, '路人');
        if (!preview && window.GameState) {
            if (node.takeItem && GameState.takeOneFromBag) {
                const took = GameState.takeOneFromBag(node.takeItem);
                if (took && window.QuestDB && QuestDB.pushNotice) {
                    QuestDB.pushNotice('交出了' + ((took.name) || node.takeItem));
                }
            }
            if (node.setFlag && GameState.setFlag) GameState.setFlag(node.setFlag);
        }
        if (node.type === 'choice') {
            const choices = (node.options || []).map(o => {
                const check = (o.check || '').trim();
                return {
                    text: this.aliasText(o.text),
                    flag: o.flag || '',
                    check: check,
                    dc: (function () { const n = parseInt(o.dc, 10); return isFinite(n) ? n : 0; })(),
                    nextRaw: this.follow(def, node, o.id),
                    failRaw: check === 'speech' ? this.follow(def, node, o.id + '_fail') : null
                };
            });
            return { speaker: window.t('npc.henry.name', '亨利'), text: '', choices: choices, next: null, nextRaw: null, done: false, side: side, portrait: portrait };
        }
        return {
            speaker: speaker,
            text: this.aliasText(node.text || '……'),
            choices: [],
            nextRaw: this.follow(def, node, 'out'),
            next: null,
            done: false,
            side: side,
            portrait: portrait
        };
    },

    previewStep(def, node) {
        node = this.skipSilent(def, node || this.graphStart(def), true, false);
        return this.speakInfo(def, node, true);
    },

    node(def, nodeId) {
        if (this.hasGraph(def)) return this.skipSilent(def, nodeId ? this.findNode(def, nodeId) : this.graphStart(def));
        if (!def || !def.nodes || !def.nodes.length) return null;
        if (nodeId) return def.nodes.find(n => n.id === nodeId) || def.nodes[0];
        if (def.start) return def.nodes.find(n => n.id === def.start) || def.nodes[0];
        return def.nodes[0];
    },

    nextNode(def, current, choiceNext) {
        if (this.hasGraph(def)) {
            if (choiceNext) return this.skipSilent(def, this.findNode(def, choiceNext) || this.follow(def, current, choiceNext));
            return this.skipSilent(def, this.follow(def, current, 'out'));
        }
        if (!def || !current) return null;
        if (choiceNext) return this.node(def, choiceNext);
        const idx = def.nodes.indexOf(current);
        if (idx >= 0 && idx < def.nodes.length - 1) return def.nodes[idx + 1];
        return null;
    },

    battleEnemies(node, def) {
        node = node || {};
        def = def || {};
        const eid = (node.enemyId || def.id || '').trim();
        const who = this.get(eid) || def;
        const kind = (node.enemyKind || '').trim() || 'guard';
        const table = (window.CONFIG && CONFIG.BATTLE && CONFIG.BATTLE.ENEMIES) || {};
        const whoName = (who && (who.name || who.speaker));
        const mainName = whoName ? this.npcDisplayName(who, '敌人') : window.t('enemy.' + kind + '.name', (table[kind] && table[kind].name) || '敌人');
        const list = [{ kind: kind, name: mainName, npcId: eid }];
        (node.extraKinds || []).forEach(k => {
            k = (k || '').trim();
            if (!k || list.length >= 3) return;
            const d = table[k] || {};
            list.push({ kind: k, name: window.t('enemy.' + k + '.name', d.name || k) });
        });
        return list;
    },

    /** 盐圈封印：亨利踩进去，鬼气上身（剧情区「剧情1」） */
    makeSaltCircleDef() {
        return {
            id: '_story_salt_circle',
            name: '盐圈里的东西',
            portrait: '',
            moods: [],
            graph: {
                nodes: [
                    { id: 's', type: 'start', x: 40, y: 80 },
                    { id: 'p1', type: 'player', x: 240, y: 80, text: '地上的盐……撒成了一个圈。像是故意封住什么。' },
                    { id: 'p2', type: 'player', x: 520, y: 80, text: '我踩进去的瞬间，背后突然发凉。像有人贴在肩胛骨上呵气。' },
                    { id: 'n1', type: 'npc', x: 800, y: 80, text: '……（盐圈里的封印松动了一线。一股又冷又凶的劲钻进你的四肢。）' },
                    { id: 'p3', type: 'player', x: 1080, y: 80, text: '力气暴涨，可我也更扎眼、更难藏了。得趁这两分钟……尽快了事。' },
                    { id: 'e1', type: 'end', x: 1360, y: 80 }
                ],
                connections: [
                    { from: 's', to: 'p1', port: 'out' },
                    { from: 'p1', to: 'p2', port: 'out' },
                    { from: 'p2', to: 'n1', port: 'out' },
                    { from: 'n1', to: 'p3', port: 'out' },
                    { from: 'p3', to: 'e1', port: 'out' }
                ]
            }
        };
    },

    /** 开锁被看见：当场问话。口才过了就走，否则开战 */
    makeCaughtDef(name, npcId, portrait) {
        const who = name || '路人';
        const eid = npcId || '';
        return {
            id: '_caught_' + (eid || 'npc'),
            name: who,
            portrait: portrait || '',
            moods: [],
            graph: {
                nodes: [
                    { id: 's', type: 'start', x: 40, y: 80 },
                    { id: 'n1', type: 'npc', x: 220, y: 80, text: '你在这箱子旁边干什么？' },
                    {
                        id: 'c1', type: 'choice', x: 480, y: 80,
                        options: [
                            { id: 'o1', text: '我是来帮这户看门的', check: 'speech', dc: 0, flag: '' },
                            { id: 'o2', text: '关你什么事', flag: '' },
                            { id: 'o3', text: '我伏法', flag: '' }
                        ]
                    },
                    { id: 'ok', type: 'npc', x: 760, y: 40, text: '……那你忙。别乱动别人的东西。' },
                    { id: 'fail', type: 'npc', x: 760, y: 220, text: '鬼话。把手举起来。' },
                    { id: 'sur', type: 'npc', x: 760, y: 400, text: '识相。把罚款交了，戴上枷，滚。' },
                    { id: 'b1', type: 'battle', x: 1000, y: 220, enemyId: eid, enemyKind: 'guard' },
                    { id: 'e1', type: 'end', x: 1000, y: 40 },
                    { id: 'e2', type: 'end', x: 1240, y: 220 },
                    { id: 'e3', type: 'end', x: 1000, y: 400, report: 'surrender' }
                ],
                connections: [
                    { from: 's', to: 'n1', port: 'out' },
                    { from: 'n1', to: 'c1', port: 'out' },
                    { from: 'c1', to: 'ok', port: 'o1' },
                    { from: 'c1', to: 'fail', port: 'o1_fail' },
                    { from: 'c1', to: 'fail', port: 'o2' },
                    { from: 'c1', to: 'sur', port: 'o3' },
                    { from: 'ok', to: 'e1', port: 'out' },
                    { from: 'fail', to: 'b1', port: 'out' },
                    { from: 'sur', to: 'e3', port: 'out' },
                    { from: 'b1', to: 'e1', port: 'win' },
                    { from: 'b1', to: 'e2', port: 'lose' }
                ]
            }
        };
    },

    /** 通缉 1 级：见面就问，还不确定。口才不把通缉算进去，说圆了就走 */
    makeWantedAskDef(name, npcId, portrait, enemyKind) {
        const who = name || '守卫';
        const eid = npcId || '';
        const kind = enemyKind || 'guard';
        const pen = (window.GameState && GameState.wanted) ? (GameState.wanted() || 0) : 0;
        return {
            id: '_wanted_' + (eid || 'npc'),
            name: who,
            portrait: portrait || '',
            moods: [],
            graph: {
                nodes: [
                    { id: 's', type: 'start', x: 40, y: 80 },
                    { id: 'n1', type: 'npc', x: 220, y: 80, text: '站住。我好像在告示上见过这张脸。' },
                    {
                        id: 'c1', type: 'choice', x: 480, y: 80,
                        options: [
                            { id: 'o1', text: '你认错人了', check: 'speech', dc: -pen, flag: '' },
                            { id: 'o2', text: '看清楚了再说', flag: '' },
                            { id: 'o3', text: '我伏法', flag: '' }
                        ]
                    },
                    { id: 'ok', type: 'npc', x: 760, y: 40, text: '……也许是看花了。走吧。' },
                    { id: 'fail', type: 'npc', x: 760, y: 220, text: '不对。别跑。' },
                    { id: 'sur', type: 'npc', x: 760, y: 400, text: '识相。罚款、枷号，然后滚出告示范围。' },
                    { id: 'b1', type: 'battle', x: 1000, y: 220, enemyId: eid, enemyKind: kind },
                    { id: 'e1', type: 'end', x: 1000, y: 40 },
                    { id: 'e2', type: 'end', x: 1240, y: 220 },
                    { id: 'e3', type: 'end', x: 1000, y: 400, report: 'surrender' }
                ],
                connections: [
                    { from: 's', to: 'n1', port: 'out' },
                    { from: 'n1', to: 'c1', port: 'out' },
                    { from: 'c1', to: 'ok', port: 'o1' },
                    { from: 'c1', to: 'fail', port: 'o1_fail' },
                    { from: 'c1', to: 'fail', port: 'o2' },
                    { from: 'c1', to: 'sur', port: 'o3' },
                    { from: 'ok', to: 'e1', port: 'out' },
                    { from: 'fail', to: 'b1', port: 'out' },
                    { from: 'sur', to: 'e3', port: 'out' },
                    { from: 'b1', to: 'e1', port: 'win' },
                    { from: 'b1', to: 'e2', port: 'lose' }
                ]
            }
        };
    },

    /** 通缉 3：村民先质问。每次随机一套。识破后，肯收钱的人改去要钱 */
    villagerPacks() {
        return [
            {
                ask: '站住。这张脸，我在告示上见过。',
                bluff: '你看错人了',
                hard: '看错了就别嚷',
                pass: '……行吧，当我看花了。',
                failSoft: '糊弄谁。不过这事也能私了。',
                failCall: '糊弄谁。我去叫守卫。'
            },
            {
                ask: '昨儿有人丢了东西。你在这转什么？',
                bluff: '我只是路过',
                hard: '关你什么事',
                pass: '那就走。别在人家门口晃。',
                failSoft: '路过的人不会这副眼神。想私了也行。',
                failCall: '嘴还硬。守卫来了你再解释。'
            },
            {
                ask: '你袖口都是灰。刚翻过别人的箱子吧。',
                bluff: '路上蹭的',
                hard: '你管得着吗',
                pass: '……也许是我多心了。走吧。',
                failSoft: '灰能蹭，这张脸蹭不掉。掏钱也行。',
                failCall: '还敢嘴硬。我这就去报。'
            },
            {
                ask: '村里在找一个贼，身形跟你像。',
                bluff: '村里身形像的人多了',
                hard: '找别人去',
                pass: '嗯。也许不是你。别让我再看见。',
                failSoft: '像就是像。不想见守卫，就拿钱来。',
                failCall: '我看就是你。站着别动，我去叫人。'
            }
        ];
    },

    makeVillagerAskDef(name, npcId, portrait, bribe) {
        const who = name || '村民';
        const packs = this.villagerPacks();
        const pack = packs[Math.floor(Math.random() * packs.length)] || packs[0];
        return {
            id: '_village_' + (npcId || 'npc'),
            name: who,
            portrait: portrait || '',
            moods: [],
            graph: {
                nodes: [
                    { id: 's', type: 'start', x: 40, y: 80 },
                    { id: 'n1', type: 'npc', x: 220, y: 80, text: pack.ask },
                    {
                        id: 'c1', type: 'choice', x: 480, y: 80,
                        options: [
                            { id: 'o1', text: pack.bluff, check: 'speech', dc: -2, flag: '' },
                            { id: 'o2', text: pack.hard, flag: '' }
                        ]
                    },
                    { id: 'ok', type: 'npc', x: 760, y: 40, text: pack.pass },
                    { id: 'fail', type: 'npc', x: 760, y: 220, text: bribe ? pack.failSoft : pack.failCall },
                    { id: 'e1', type: 'end', x: 1000, y: 40, report: 'pass' },
                    { id: 'e2', type: 'end', x: 1000, y: 220, report: 'call' }
                ],
                connections: [
                    { from: 's', to: 'n1', port: 'out' },
                    { from: 'n1', to: 'c1', port: 'out' },
                    { from: 'c1', to: 'ok', port: 'o1' },
                    { from: 'c1', to: 'fail', port: 'o1_fail' },
                    { from: 'c1', to: 'fail', port: 'o2' },
                    { from: 'ok', to: 'e1', port: 'out' },
                    { from: 'fail', to: 'e2', port: 'out' }
                ]
            }
        };
    },

    makeVillagerBribeDef(name, portrait, price) {
        const who = name || '村民';
        const n = Math.max(1, parseInt(price, 10) || 50);
        return {
            id: '_vbribe_' + who,
            name: who,
            portrait: portrait || '',
            moods: [],
            graph: {
                nodes: [
                    { id: 's', type: 'start', x: 40, y: 80 },
                    { id: 'n1', type: 'npc', x: 220, y: 80, text: window.t('dlg.bribeAsk', '堵上嘴。{n} 格罗申，我就当没看见。', { n: n }) },
                    {
                        id: 'c1', type: 'choice', x: 520, y: 80,
                        options: [
                            { id: 'o1', text: window.t('dlg.bribePay', '给你 {n} 格罗申', { n: n }), flag: '' },
                            { id: 'o2', text: window.t('dlg.bribeNo', '一个子儿都不给'), flag: '' }
                        ]
                    },
                    { id: 'ok', type: 'npc', x: 800, y: 40, text: window.t('dlg.bribeOk', '嗯。走吧，当我眼瞎。') },
                    { id: 'no', type: 'npc', x: 800, y: 220, text: window.t('dlg.bribeCall', '那你等着。我去叫守卫。') },
                    { id: 'e1', type: 'end', x: 1040, y: 40, report: 'pay' },
                    { id: 'e2', type: 'end', x: 1040, y: 220, report: 'call' }
                ],
                connections: [
                    { from: 's', to: 'n1', port: 'out' },
                    { from: 'n1', to: 'c1', port: 'out' },
                    { from: 'c1', to: 'ok', port: 'o1' },
                    { from: 'c1', to: 'no', port: 'o2' },
                    { from: 'ok', to: 'e1', port: 'out' },
                    { from: 'no', to: 'e2', port: 'out' }
                ]
            }
        };
    }
};
