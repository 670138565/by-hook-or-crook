/* =====================================================================
 * 战斗逻辑（Combat.js）
 * 背包即战场。生命和走路共用 GameState.生命。
 * 能量读物品表 combat.energy。消耗品不耗能量、用完消失。
 * 弓弩只射发射侧贴着的箭。武器、防具、盾牌、饰品、战斗药水已接入。
 * ===================================================================== */
window.Combat = {
    _id: 0,

    placedItems() {
        return (GameState.get('backpackItems', []) || []).filter(it =>
            GameState.isItemPlaced(it) && (it.owner || 'backpack') === 'backpack'
        );
    },

    occupyMap() {
        const map = {};
        this.placedItems().forEach(it => {
            ItemDB.worldCells(it).forEach(p => { map[p.c + ',' + p.r] = it; });
        });
        return map;
    },

    unlockedEmptyCount() {
        const cols = CONFIG.BACKPACK.GRID_COLS;
        const rows = CONFIG.BACKPACK.GRID_ROWS;
        const occ = this.occupyMap();
        let n = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!GameState.isCellUnlocked(c, r)) continue;
                if (!occ[c + ',' + r]) n++;
            }
        }
        return n;
    },

    isUnlockedEmpty(c, r) {
        if (!GameState.isCellUnlocked(c, r)) return false;
        return !this.occupyMap()[c + ',' + r];
    },

    kindFromName(name) {
        const s = name || '';
        if (/狗/.test(s)) return 'dog';
        if (/精英/.test(s)) return 'elite';
        if (/队长/.test(s)) return 'captain';
        if (/强盗/.test(s)) return 'bandit';
        return 'guard';
    },

    enemyDef(kind) {
        const table = (CONFIG.BATTLE && CONFIG.BATTLE.ENEMIES) || {};
        return table[kind] || table.guard || { name: '敌人', hp: 35, shield: 0, behaviors: [{ type: 'attack', value: 8, w: 100 }], gold: 8 };
    },

    makeEnemy(kind, name, npcId) {
        const def = this.enemyDef(kind);
        return {
            uid: 'e' + (++this._id),
            kind: kind,
            npcId: npcId || '',
            name: name || window.t('enemy.' + kind + '.name', def.name || '敌人'),
            hp: def.hp,
            maxHp: def.hp,
            baseShield: def.shield || 0,
            shield: 0,
            nextBlock: 0,
            burnPenalty: 0,
            poison: 0,
            burn: 0,
            stun: 0,
            noShield: 0,
            thornsOnBreak: def.thornsOnBreak || 0,
            behaviors: def.behaviors || [{ type: 'attack', value: 8, w: 100 }],
            gold: def.gold || 0,
            xp: def.xp || 0,
            lootTable: def.lootTable || '',
            dead: false
        };
    },

    start(spec) {
        spec = spec || {};
        const list = spec.enemies && spec.enemies.length
            ? spec.enemies
            : [{
                kind: spec.enemyKind || this.kindFromName(spec.enemyName),
                name: spec.enemyName,
                npcId: spec.enemyId
            }];
        let enemies = list.map(e => this.makeEnemy(e.kind || this.kindFromName(e.name), e.name, e.npcId || spec.enemyId));
        const named = {};
        enemies.forEach(en => { named[en.name] = (named[en.name] || 0) + 1; });
        const seen = {};
        enemies.forEach(en => {
            if (named[en.name] < 2) return;
            seen[en.name] = (seen[en.name] || 0) + 1;
            en.name = en.name + ' ' + seen[en.name];
        });
        const n = enemies.length;
        if (n >= 2) {
            enemies.forEach(en => {
                en.behaviors = en.behaviors.map(b => {
                    const copy = {};
                    Object.keys(b).forEach(k => { copy[k] = b[k]; });
                    if (copy.extra && typeof copy.extra === 'object') {
                        const ex = {};
                        Object.keys(copy.extra).forEach(k => { ex[k] = copy.extra[k]; });
                        copy.extra = ex;
                    }
                    if (copy.type === 'attack') copy.value = Math.max(1, (copy.value || 0) - 3 - (n >= 3 ? 1 : 0));
                    if (copy.type === 'heal') copy.value = Math.max(0, (copy.value || 0) - 2);
                    if (copy.type === 'block') copy.value = Math.max(0, (copy.value || 0) - 1);
                    return copy;
                });
                en.baseShield = Math.max(0, en.baseShield - 1);
            });
        }
        this.state = {
            phase: 'player',
            turn: 1,
            energy: 0,
            energyMax: 0,
            playerShield: 0,
            shieldUsed: false,
            log: [],
            finished: false,
            won: false,
            fled: false,
            enemies: enemies,
            target: 0,
            dealtThisTurn: 0,
            charges: {},
            nextShield: 0,
            hitThisTurn: false,
            shieldBrokenThisTurn: false,
            hadShieldAtTurnStart: false,
            battleFirstHit: false,
            turnFirstHit: false,
            usedShield: null,
            intimidate: 0,
            meleeThorns: 0,
            reflecting: false,
            survivedOnce: false,
            fateDmg: 0,
            fateShield: 0,
            fateEnergy: 0,
            ragePct: 0,
            playerPoison: 0,
            playerBurn: 0,
            playerStun: 0,
            playerBurnPenalty: 0,
            playerStunAppliedTurn: -1,
            nextPoison: 0,
            caught: !!spec.caught,
            firstStrike: this.placedItems().some(it => ItemDB.hasCombatEffect(it, 'launcher') && (ItemDB.combatEffects(it).find(e => e.type === 'launcher') || {}).firstStrike)
        };
        this.turnStart();
        return this.state;
    },

    living() {
        return (this.state.enemies || []).filter(e => !e.dead && e.hp > 0);
    },

    currentTarget() {
        const live = this.living();
        if (!live.length) return null;
        let t = live.find(e => e.uid === (this.state.enemies[this.state.target] && this.state.enemies[this.state.target].uid));
        return t || live[0];
    },

    setTarget(en) {
        const s = this.state;
        if (!s || !en) return false;
        const i = s.enemies.indexOf(en);
        if (i < 0 || en.dead || en.hp <= 0) return false;
        s.target = i;
        return true;
    },

    setTargetIndex(n) {
        const live = this.living();
        const en = live[n];
        return en ? this.setTarget(en) : false;
    },

    log(msg) {
        if (!this.state) return;
        this.state.log.push(msg);
        if (this.state.log.length > 8) this.state.log.shift();
    },

    armorShieldBonus() {
        let n = 0;
        this.placedItems().forEach(it => {
            const cat = ItemDB.combatCat(it);
            const c = ItemDB.combatOf(it);
            if (!c) return;
            if (cat === 'armor' || cat === 'trinket') n += c.shield || 0;
            ItemDB.combatEffects(it).forEach(e => {
                if (e.type === 'first_turn' && this.state.turn === 1) n += e.shield || 0;
            });
        });
        return n;
    },

    energyBonus() {
        const s = this.state || {};
        let n = s.fateEnergy || 0;
        this.eachCombatEffect((e, it) => {
            if (e.type === 'if_row1_energy' && this.itemInRow1(it)) n += e.value || 0;
            if (e.type === 'turn_energy_shield') n += e.energy || 0;
        });
        return n;
    },

    eachCombatEffect(fn) {
        this.placedItems().forEach(it => {
            ItemDB.combatEffects(it).forEach(e => {
                if (e) fn(e, it, ItemDB.combatCat(it));
            });
        });
    },

    sumEffect(type, field) {
        let n = 0;
        this.eachCombatEffect(e => {
            if (e.type === type) n += e[field] || 0;
        });
        return n;
    },

    tryDodge() {
        let chance = 0;
        this.eachCombatEffect(e => {
            if (e.type === 'dodge') chance += e.chance || 0;
        });
        return chance > 0 && Math.random() * 100 < chance;
    },

    turnStart() {
        const s = this.state;
        s.phase = 'player';
        s.shieldUsed = false;
        s.dealtThisTurn = 0;
        s.hitThisTurn = false;
        s.shieldBrokenThisTurn = false;
        s.turnFirstHit = false;
        s.usedShield = null;
        s.intimidate = 0;
        s.meleeThorns = 0;
        s.ragePct = 0;
        this.rollFate();
        s.energyMax = (CONFIG.BATTLE.ENERGY || 3) + this.energyBonus();
        s.energy = s.energyMax;
        const extra = s.nextShield || 0;
        s.nextShield = 0;
        let sh = this.armorShieldBonus() + extra + this.trinketShieldBonus();
        if (s.playerBurnPenalty) {
            sh = Math.max(0, sh - s.playerBurnPenalty);
            s.playerBurnPenalty = 0;
        }
        s.playerShield = sh;
        this.eachCombatEffect((e, it) => {
            if (e.type === 'lucky_shield' && Math.random() * 100 < (e.chance || 0)) {
                s.playerShield += e.shield || 0;
                this.log((it.name || '衣服') + '幸运，护盾 +' + (e.shield || 0) + '。');
            }
        });
        s.hadShieldAtTurnStart = s.playerShield > 0;
        s.enemies.forEach(en => {
            if (en.dead) return;
            if (en.noShield > 0) {
                en.shield = 0;
                en.noShield -= 1;
            } else {
                en.shield = Math.max(0, en.baseShield + en.nextBlock - en.burnPenalty);
            }
            en.nextBlock = 0;
            en.burnPenalty = 0;
        });
        this.log('第 ' + s.turn + ' 回合。能量 ' + s.energy + '，护盾 ' + s.playerShield + '。');
        if (extra) this.log('额外护盾 +' + extra + '。');
        if (s.playerStun > 0) this.log('你眩晕了，只能喝解眩的药。');
        if (s.turn === 1 && s.firstStrike) this.log('先手：敌人第一回合无法行动。');
    },

    hit(who, dmg, pierce, attacker) {
        dmg = Math.max(0, Math.floor(dmg));
        if (dmg <= 0) return { hp: 0, shield: 0 };
        if (who === 'player') return this.playerTakeHit(attacker, dmg, pierce);
        const en = who;
        if (pierce) {
            en.hp = Math.max(0, en.hp - dmg);
            if (en.hp <= 0) en.dead = true;
            if (this.state.phase === 'player') {
                this.state.dealtThisTurn = (this.state.dealtThisTurn || 0) + dmg;
            }
            this.noteHit('enemy', en.uid, dmg);
            return { hp: dmg, shield: 0 };
        }
        const had = en.shield;
        const soak = Math.min(en.shield, dmg);
        en.shield -= soak;
        const rest = dmg - soak;
        en.hp = Math.max(0, en.hp - rest);
        if (had > 0 && en.shield <= 0 && rest > 0 && en.thornsOnBreak) {
            this.hit('player', en.thornsOnBreak, false, en);
            this.log(en.name + '的铁壁反了 ' + en.thornsOnBreak + ' 点。');
        }
        if (en.hp <= 0) en.dead = true;
        if (this.state.phase === 'player') {
            this.state.dealtThisTurn = (this.state.dealtThisTurn || 0) + rest + soak;
        }
        this.noteHit('enemy', en.uid, rest + soak);
        return { hp: rest, shield: soak };
    },

    noteHit(side, uid, amount) {
        if (!this.state || amount <= 0) return;
        if (!this.state.fxHits) this.state.fxHits = [];
        this.state.fxHits.push({ side: side, uid: uid || '', n: amount });
    },

    takeFxHits() {
        const list = (this.state && this.state.fxHits) || [];
        if (this.state) this.state.fxHits = [];
        return list;
    },

    playerTakeHit(attacker, dmg, pierce) {
        const s = this.state;
        if (pierce) {
            GameState.hurt(dmg);
            this.trySurvive();
            this.noteHit('player', '', dmg);
            return { hp: dmg, shield: 0 };
        }
        if (this.tryDodge()) {
            this.log('闪避。');
            return { hp: 0, shield: 0 };
        }
        if (!s.battleFirstHit) {
            s.battleFirstHit = true;
            const extra = this.sumEffect('first_hit', 'shield');
            if (extra) {
                s.playerShield += extra;
                this.log('硬抗，护盾 +' + extra + '。');
            }
        }
        if (!s.turnFirstHit) {
            s.turnFirstHit = true;
            if (s.usedShield && ItemDB.hasCombatEffect(s.usedShield, 'first_hit_heal')) {
                const fx = ItemDB.combatEffects(s.usedShield).find(e => e && e.type === 'first_hit_heal');
                if (fx && GameState.heal) {
                    const r = GameState.heal(fx.value || 1);
                    if (r.gained) this.log('圣徽，生命 +' + r.gained + '。');
                }
            }
        }
        s.hitThisTurn = true;
        const had = s.playerShield;
        const soak = Math.min(s.playerShield, dmg);
        s.playerShield -= soak;
        let rest = dmg - soak;
        if (had > 0 && s.playerShield <= 0) {
            s.shieldBrokenThisTurn = true;
            const bounce = this.sumEffect('on_shield_break_turn', 'shield');
            if (bounce) {
                s.playerShield += bounce;
                this.log('破盾韧性，护盾 +' + bounce + '。');
            }
            const brk = this.sumEffect('on_shield_break', 'thorns');
            if (brk && attacker && !s.reflecting) {
                s.reflecting = true;
                this.hit(attacker, brk, false);
                s.reflecting = false;
                this.log('破盾反了 ' + brk + ' 点。');
            }
        }
        const red = this.sumEffect('overflow_reduce', 'value');
        if (rest && red) rest = Math.max(0, rest - red);
        if (rest) GameState.hurt(rest);
        this.trySurvive();
        if (!s.reflecting && attacker && !attacker.dead) {
            let thorns = this.sumEffect('thorns', 'value') + (s.meleeThorns || 0) + this.adjWeaponThorns();
            if (thorns) {
                s.reflecting = true;
                this.hit(attacker, thorns, false);
                s.reflecting = false;
                this.log('反震 ' + thorns + ' 点。');
            }
        }
        this.noteHit('player', '', rest + soak);
        return { hp: rest, shield: soak };
    },

    checkEnd() {
        if (this.state.finished) return true;
        if (this.living().length === 0) {
            this.finish(true, false);
            return true;
        }
        if (GameState.get('生命', 0) <= 0) {
            GameState.set('生命', 1);
            this.finish(false, false);
            return true;
        }
        return false;
    },

    finish(won, fled) {
        this.state.finished = true;
        this.state.won = !!won;
        this.state.fled = !!fled;
        this.state.phase = 'done';
        this.state.lootLine = '';
        if (won) {
            let gold = 0;
            let lockpicks = 0;
            const defs = [];
            this.state.enemies.forEach(en => {
                gold += en.gold || 0;
                const tableId = en.lootTable;
                if (tableId && window.LootDB && LootDB.roll) {
                    const got = LootDB.roll(tableId, GameState.uniqueCtx ? GameState.uniqueCtx() : {});
                    gold += got.gold || 0;
                    lockpicks += got.lockpicks || 0;
                    (got.defs || []).forEach(d => defs.push(d));
                }
            });
            if (gold) GameState.add('金币', gold);
            if (lockpicks) GameState.gainLockpicks(lockpicks);
            let xp = 0;
            this.state.enemies.forEach(en => { xp += en.xp || 0; });
            const grew = (xp && GameState.gainXp) ? GameState.gainXp(xp) : { xp: 0, levels: [] };
            const given = GameState.giveLootDefs ? GameState.giveLootDefs(defs) : { names: [], ground: [] };
            if (GameState.setPendingGroundLoot) GameState.setPendingGroundLoot(given.ground || []);
            this.state.enemies.forEach(en => {
                if (en.npcId && GameState.markKilled) GameState.markKilled(en.npcId);
            });
            let msg = '你赢了。';
            if (gold) msg += window.t('battle.goldGain', '格罗申 +{n}。', { n: gold });
            if (lockpicks) msg += '开锁器 +' + lockpicks + '。';
            if (xp) msg += '经验 +' + xp + '。';
            if (grew.levels && grew.levels.length) {
                msg += '升到 ' + grew.levels.join('、') + ' 级。生命上限 '
                    + GameState.get('生命上限') + '，扩展点 +' + grew.levels.length + '。';
            }
            if (given.names && given.names.length) msg += '掉落：' + given.names.join('、') + '。';
            msg += this.wantedLine(true);
            this.state.lootLine = msg;
            GameState._lastLootLine = msg;
            this.log(msg);
        } else {
            if (GameState.setPendingGroundLoot) GameState.setPendingGroundLoot([]);
            if (fled) {
                let msg = '你跑了。';
                msg += this.wantedLine(false);
                this.state.lootLine = msg;
                this.log(msg);
            } else if (this.state.surrendered) {
                this.state.lootLine = '你举手伏法。';
                this.log(this.state.lootLine);
            } else {
                // 战败伏法：不在这里加通缉，由 GameScene 按档位罚款+DEBUFF
                this.state.lootLine = '你倒下了，被拿下了。';
                this.log(this.state.lootLine);
            }
        }
    },

    /** 战斗中主动伏法（不逃跑、不加通缉） */
    surrender() {
        if (!this.state || this.state.finished) return;
        this.state.surrendered = true;
        this.finish(false, false);
    },

    wantedLine(won) {
        const s = this.state;
        if (!s) return '';
        if (won && !s.caught) return '';
        if (!GameState.addWanted) return '';
        const w = GameState.addWanted(1);
        if (!w || !w.added) return '';
        return '通缉 +' + w.added + '（' + w.after + '/' + GameState.wantedMax() + '）。';
    },

    emptyDmgBonus() {
        return this.trinketEmptyDmg();
    },

    trinketEmptyDmg() {
        const empty = this.unlockedEmptyCount();
        let n = 0;
        this.placedItems().forEach(it => {
            if (ItemDB.combatCat(it) !== 'trinket') return;
            ItemDB.combatEffects(it).forEach(e => {
                if (e.type === 'empty_dmg') n += Math.min(e.cap || 99, empty * (e.per || 1));
            });
        });
        return n;
    },

    weaponEmptyBonus(it) {
        const empty = this.unlockedEmptyCount();
        let n = this.trinketEmptyDmg();
        ItemDB.combatEffects(it).forEach(e => {
            if (e.type === 'empty_dmg') n += Math.min(e.cap || 99, empty * (e.per || 1));
        });
        return n;
    },

    leftmostUnlockedCol() {
        return this.unlockedBounds().minC;
    },

    unlockedBounds() {
        const cols = CONFIG.BACKPACK.GRID_COLS;
        const rows = CONFIG.BACKPACK.GRID_ROWS;
        let minC = cols, maxC = -1, minR = rows, maxR = -1;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!GameState.isCellUnlocked(c, r)) continue;
                if (c < minC) minC = c;
                if (c > maxC) maxC = c;
                if (r < minR) minR = r;
                if (r > maxR) maxR = r;
            }
        }
        if (maxC < 0) return { minC: 0, maxC: 0, minR: 0, maxR: 0 };
        return { minC: minC, maxC: maxC, minR: minR, maxR: maxR };
    },

    itemTouchesCol(it, col) {
        return ItemDB.worldCells(it).some(p => p.c === col);
    },

    itemInCol1(it) {
        return this.itemTouchesCol(it, this.unlockedBounds().minC);
    },

    itemInRow1(it) {
        const row = this.unlockedBounds().minR;
        return ItemDB.worldCells(it).some(p => p.r === row);
    },

    itemInCenter(it) {
        const b = this.unlockedBounds();
        const c0 = b.minC + Math.floor((b.maxC - b.minC + 1 - 2) / 2);
        const r0 = b.minR + Math.floor((b.maxR - b.minR + 1 - 2) / 2);
        return ItemDB.worldCells(it).some(p => p.c >= c0 && p.c <= c0 + 1 && p.r >= r0 && p.r <= r0 + 1);
    },

    countCombatCat(cat, skipArrows) {
        let n = 0;
        this.placedItems().forEach(it => {
            if (skipArrows && ItemDB.isArrow(it)) return;
            if (ItemDB.combatCat(it) === cat) n++;
        });
        return n;
    },

    adjNeighbors(it) {
        const occ = this.occupyMap();
        const seen = {};
        const out = [];
        ItemDB.worldCells(it).forEach(p => {
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (!dr && !dc) continue;
                    const o = occ[(p.c + dc) + ',' + (p.r + dr)];
                    if (!o || o === it || seen[o.id]) continue;
                    seen[o.id] = 1;
                    out.push(o);
                }
            }
        });
        return out;
    },

    playerLowHp(pct) {
        const hp = GameState.get('生命', 0);
        const max = GameState.get('生命上限', 30);
        return max > 0 && hp * 100 < max * (pct || 50);
    },

    rollFate() {
        const s = this.state;
        s.fateDmg = 0;
        s.fateShield = 0;
        s.fateEnergy = 0;
        this.eachCombatEffect(e => {
            if (e.type !== 'random_turn' || !e.options || !e.options.length) return;
            const opt = e.options[Math.floor(Math.random() * e.options.length)];
            if (opt.dmg) { s.fateDmg += opt.dmg; this.log('命运：伤害 +' + opt.dmg + '。'); }
            if (opt.shield) { s.fateShield += opt.shield; this.log('命运：护盾 +' + opt.shield + '。'); }
            if (opt.energy) { s.fateEnergy += opt.energy; this.log('命运：能量 +' + opt.energy + '。'); }
        });
    },

    trinketShieldBonus() {
        const s = this.state || {};
        let n = s.fateShield || 0;
        const empty = this.unlockedEmptyCount();
        const valuables = this.countCombatCat('valuable');
        this.eachCombatEffect((e, it) => {
            if (e.type === 'empty_shield') n += Math.min(e.cap || 99, empty * (e.per || 1));
            if (e.type === 'per_valuable_shield' || e.type === 'per_valuable_shield_extra') {
                n += Math.min(e.cap || 99, valuables * (e.per || 1));
            }
            if (e.type === 'regen_shield') n += e.value || 0;
            if (e.type === 'adj8_armor_shield') {
                const k = this.adjNeighbors(it).filter(x => {
                    const c = ItemDB.combatCat(x);
                    return c === 'armor' || c === 'shield';
                }).length;
                n += Math.min(e.cap || 99, k * (e.per || 1));
            }
            if (e.type === 'if_center_bonus' && this.itemInCenter(it)) n += e.shield || 0;
            if (e.type === 'if_low_hp' && this.playerLowHp(e.hpPct)) n += e.shield || 0;
            if (e.type === 'turn_energy_shield') n += e.shield || 0;
        });
        return n;
    },

    trinketDmgBonus() {
        const s = this.state || {};
        let n = s.fateDmg || 0;
        const weapons = this.countCombatCat('weapon', true);
        const valuables = this.countCombatCat('valuable');
        this.eachCombatEffect((e, it) => {
            if (e.type === 'per_weapon_dmg') n += Math.min(e.cap || 99, weapons * (e.per || 1));
            if (e.type === 'per_valuable_dmg') n += Math.min(e.cap || 99, valuables * (e.per || 1));
            if (e.type === 'if_col1_dmg' && this.itemInCol1(it)) n += e.value || 0;
            if (e.type === 'if_center_bonus' && this.itemInCenter(it)) n += e.dmg || 0;
            if (e.type === 'if_low_hp' && this.playerLowHp(e.hpPct)) n += e.dmg || 0;
        });
        return n;
    },

    adjWeaponThorns() {
        let n = 0;
        this.eachCombatEffect((e, it) => {
            if (e.type !== 'adj8_weapon_thorns') return;
            const k = this.adjNeighbors(it).filter(x =>
                ItemDB.combatCat(x) === 'weapon' && !ItemDB.isArrow(x)
            ).length;
            n += Math.min(e.cap || 99, k * (e.per || 1));
        });
        return n;
    },

    trySurvive() {
        if (GameState.get('生命', 0) > 0) return;
        if (this.state.survivedOnce) return;
        let has = false;
        this.eachCombatEffect(e => { if (e.type === 'once_survive') has = true; });
        if (!has) return;
        this.state.survivedOnce = true;
        GameState.set('生命', 1);
        this.log('不朽：留下 1 点生命。');
    },

    colWeaponCount() {
        const col = this.leftmostUnlockedCol();
        const seen = {};
        let n = 0;
        this.placedItems().forEach(it => {
            if (ItemDB.isArrow(it)) return;
            if (ItemDB.combatCat(it) !== 'weapon') return;
            if (!ItemDB.worldCells(it).some(p => p.c === col)) return;
            if (seen[it.id]) return;
            seen[it.id] = 1;
            n++;
        });
        return n;
    },

    computeWeaponDmg(it, foe) {
        const cbt = ItemDB.combatOf(it) || {};
        const fx = ItemDB.combatEffects(it);
        const notes = [];
        let base = cbt.dmg || 0;
        const vsSh = fx.find(e => e && e.type === 'vs_shielded');
        if (vsSh && foe && foe.shield > 0) {
            base = vsSh.dmg != null ? vsSh.dmg : base;
            notes.push('对持盾 ' + base);
        }
        const emptyAdd = this.weaponEmptyBonus(it);
        const aura = this.trinketDmgBonus();
        let dmg = base + emptyAdd + aura;
        if (emptyAdd) notes.push('空格 +' + emptyAdd);
        if (aura) notes.push('饰品 +' + aura);
        const buffDmg = (window.GameState && GameState.timedBuffMods)
            ? (GameState.timedBuffMods().damage || 0) : 0;
        if (buffDmg) {
            dmg += buffDmg;
            notes.push('附身 +' + buffDmg);
        }
        if (this.state.ragePct) {
            const add = Math.floor(dmg * this.state.ragePct / 100);
            if (add) { dmg += add; notes.push('狂怒 +' + add); }
        }
        const chase = fx.find(e => e && e.type === 'chase');
        if (chase) {
            const add = Math.min(chase.cap || 99, Math.floor((this.state.dealtThisTurn || 0) * (chase.pct || 0) / 100));
            if (add) { dmg += add; notes.push('追击 +' + add); }
        }
        const colw = fx.find(e => e && e.type === 'col_weapons');
        if (colw) {
            const add = Math.min(colw.cap || 99, this.colWeaponCount() * (colw.per || 2));
            if (add) { dmg += add; notes.push('列阵 +' + add); }
        }
        const grow = fx.find(e => e && e.type === 'grow_kill');
        if (grow) {
            const stacks = Math.min(grow.cap || 99, it.killGrow || 0);
            if (stacks) { dmg += stacks * (grow.per || 1); notes.push('成长 +' + stacks); }
        }
        const half = fx.find(e => e && e.type === 'below_half');
        if (half && foe && foe.maxHp > 0 && foe.hp * 2 <= foe.maxHp) {
            const add = Math.min(half.cap || 99, Math.floor(dmg * (half.pct || 0) / 100));
            if (add) { dmg += add; notes.push('半血 +' + add); }
        }
        const vsSt = fx.find(e => e && e.type === 'vs_status');
        if (vsSt && foe) {
            const ok = (vsSt.statuses || []).some(st => (foe[st] || 0) > 0);
            if (ok) {
                const add = Math.min(vsSt.cap || 99, Math.floor(dmg * (vsSt.pct || 0) / 100));
                if (add) { dmg += add; notes.push('状态 +' + add); }
            }
        }
        return { dmg: dmg, notes: notes };
    },

    applyWeaponExtras(it, foe, fx, hadShield) {
        const extraLogs = [];
        fx.forEach(e => {
            if (!e) return;
            if (e.type === 'poison' && e.stacks) {
                foe.poison += e.stacks;
                extraLogs.push('中毒 +' + e.stacks + '。');
            }
            if (e.type === 'hook_guard' && Math.random() * 100 < (e.chance || 0)) {
                foe.noShield = Math.max(foe.noShield || 0, 1);
                extraLogs.push('勾防：下回合没有护盾。');
            }
            if (e.type === 'stun' && Math.random() * 100 < (e.chance || 0)) {
                foe.stun = Math.max(foe.stun || 0, 1);
                extraLogs.push('眩晕。');
            }
        });
        if (hadShield && fx.some(e => e && e.type === 'break_shield')) extraLogs.push('破盾。');
        const grow = fx.find(e => e && e.type === 'grow_kill');
        if (grow && foe.dead) {
            const cap = grow.cap || 99;
            const before = it.killGrow || 0;
            it.killGrow = Math.min(cap, before + (grow.per || 1));
            if (it.killGrow > before) extraLogs.push('成长 ' + it.killGrow + '/' + cap + '。');
        }
        return extraLogs;
    },

    arrowsTouching(launcher) {
        const side = {};
        ItemDB.fireSideCells(launcher).forEach(p => { side[p.c + ',' + p.r] = 1; });
        return this.placedItems().filter(it => {
            if (it === launcher || !ItemDB.isArrow(it)) return false;
            return ItemDB.worldCells(it).some(p => side[p.c + ',' + p.r]);
        });
    },

    bestTouchingArrow(launcher) {
        const list = this.arrowsTouching(launcher);
        if (!list.length) return null;
        list.sort((a, b) => ItemDB.qualityOf(b) - ItemDB.qualityOf(a));
        return list[0];
    },

    directionEmpty(arrow) {
        const face = ItemDB.facing(arrow);
        const d = ItemDB.facingDelta(face);
        const set = {};
        ItemDB.worldCells(arrow).forEach(p => { set[p.c + ',' + p.r] = 1; });
        const tips = ItemDB.worldCells(arrow).filter(p => !set[(p.c + d[0]) + ',' + (p.r + d[1])]);
        if (!tips.length) return 0;
        let best = 0;
        tips.forEach(t => {
            let n = 0;
            let c = t.c + d[0], r = t.r + d[1];
            while (this.isUnlockedEmpty(c, r)) {
                n++;
                c += d[0];
                r += d[1];
            }
            if (n > best) best = n;
        });
        return best;
    },

    applyStatuses(en, effects) {
        (effects || []).forEach(e => {
            if (e.type === 'poison') en.poison += e.stacks || 1;
            if (e.type === 'arrow_poison') { /* handled by arrow */ }
        });
    },

    clearPlayerStatus(which) {
        const s = this.state;
        const logs = [];
        if ((which === 'all' || which === 'poison') && s.playerPoison > 0) {
            s.playerPoison = 0;
            logs.push('解除了中毒。');
        }
        if ((which === 'all' || which === 'burn') && s.playerBurn > 0) {
            s.playerBurn = 0;
            logs.push('解除了燃烧。');
        }
        if ((which === 'all' || which === 'stun') && s.playerStun > 0) {
            s.playerStun = 0;
            logs.push('解除了眩晕。');
        }
        return logs;
    },

    usePotion(it, cbt) {
        const s = this.state;
        const fx = ItemDB.combatEffects(it);
        const logs = [];
        let did = false;
        if (cbt.heal > 0 && GameState.heal) {
            const r = GameState.heal(cbt.heal);
            if (r.gained > 0) {
                logs.push((it.name || '药品') + '：生命 +' + r.gained + '。');
                did = true;
            }
        }
        fx.forEach(e => {
            if (!e) return;
            if (e.type === 'clear') {
                const got = this.clearPlayerStatus(e.status || 'all');
                if (got.length) {
                    logs.push.apply(logs, got);
                    did = true;
                }
            }
            if (e.type === 'gain_energy') {
                const v = e.value || 1;
                if (s.energy < s.energyMax) {
                    const before = s.energy;
                    s.energy = Math.min(s.energyMax, s.energy + v);
                    logs.push((it.name || '药剂') + '：能量 +' + (s.energy - before) + '。');
                    did = true;
                }
            }
            if (e.type === 'rage') {
                s.ragePct = e.pct || 50;
                logs.push('狂怒：本回合伤害 +' + s.ragePct + '%。');
                did = true;
            }
        });
        if (!did) {
            if (cbt.heal > 0) return { ok: false, msg: '生命已满。' };
            if (fx.some(e => e && e.type === 'gain_energy')) return { ok: false, msg: '能量已满。' };
            if (fx.some(e => e && e.type === 'clear')) return { ok: false, msg: '没有要解的状态。' };
            return { ok: false, msg: (it.name || '药品') + '现在用不了。' };
        }
        logs.forEach(m => this.log(m));
        this.checkEnd();
        return this.useResult(it, logs[0] || '喝药。');
    },

    useItem(it, target) {
        const s = this.state;
        if (!s || s.finished || s.phase !== 'player') return { ok: false, msg: '还没轮到你。' };
        if (!it || !GameState.isItemPlaced(it)) return { ok: false, msg: '先放进格子。' };
        const def = ItemDB.defOf(it);
        const cbt = ItemDB.combatOf(it) || {};
        const cat = ItemDB.combatCat(it);
        const en = target || this.currentTarget();

        if (s.playerStun > 0) {
            const can = cat === 'potion' && ItemDB.combatEffects(it).some(e =>
                e && e.type === 'clear' && (e.status === 'stun' || e.status === 'all')
            );
            if (!can) return { ok: false, msg: '你眩晕了。' };
        }

        if (cbt.inCombat === false || cat === 'food') {
            return { ok: false, msg: (it.name || '这个') + '只能在战斗外用。' };
        }
        if (cat === 'armor' || cat === 'trinket') {
            return { ok: false, msg: (it.name || '这件') + '不用点，效果已经算上了。' };
        }

        if (ItemDB.isArrow(it)) {
            return { ok: false, msg: '点弓或弩来射这支箭。' };
        }

        const fxAll = ItemDB.combatEffects(it);
        const coat = fxAll.find(e => e && e.type === 'next_poison');
        if (coat) {
            s.nextPoison = (s.nextPoison || 0) + (coat.stacks || 3);
            this.log('抹毒，下次攻击中毒 +' + s.nextPoison + '。');
            this.removeItem(it);
            return { ok: true, msg: '抹毒。', consumed: true, item: it };
        }
        if (fxAll.some(e => e && e.type === 'light')) {
            return { ok: false, msg: (it.name || '这个') + '在战斗里用不着。' };
        }

        if (ItemDB.isLauncher(it)) {
            const cost = this.energyCost(it, cbt);
            if (s.energy < cost) return { ok: false, msg: '能量不够。' };
            const arrow = this.bestTouchingArrow(it);
            if (!arrow) return { ok: false, msg: ItemDB.fireDirName(it) + '没有贴着的箭。' };
            if (!en) return { ok: false, msg: '没有目标。' };
            s.energy -= cost;
            const empty = this.directionEmpty(arrow);
            const fx = ItemDB.combatEffects(arrow);
            const launch = ItemDB.combatEffects(it).find(e => e && e.type === 'launcher') || {};
            let dmgMul = 1;
            let chargeNote = '';
            if (launch.charge) {
                s.charges = s.charges || {};
                const need = launch.charge;
                const next = (s.charges[it.id] || 0) + 1;
                if (next >= need) {
                    dmgMul = launch.chargeMul || 2;
                    s.charges[it.id] = 0;
                    chargeNote = '充能翻倍';
                } else {
                    s.charges[it.id] = next;
                    chargeNote = '充能 ' + next + '/' + need;
                }
            }
            const logs = [];
            fx.forEach(e => {
                if (e.type === 'arrow') {
                    let dmg = Math.floor(((e.base || 0) + empty * (e.emptyMul || 0) + this.trinketEmptyDmg() + this.trinketDmgBonus()) * dmgMul);
                    if (s.ragePct) dmg = Math.floor(dmg * (100 + s.ragePct) / 100);
                    this.hit(en, dmg, false);
                    logs.push((it.name || '弓') + '射出' + arrow.name + '，' + dmg + ' 伤（方向空格 ' + empty
                        + (dmgMul > 1 ? '，' + chargeNote : '') + '）。');
                }
                if (e.type === 'arrow_poison') {
                    const st = (e.base || 1) + empty * (e.emptyMul || 1);
                    en.poison += st;
                    logs.push(arrow.name + '中毒 +' + st + '（方向空格 ' + empty + '）。');
                }
                if (e.type === 'arrow_burn') {
                    const st = (e.base || 1) + empty * (e.emptyMul || 1);
                    en.burn += st;
                    logs.push(arrow.name + '燃烧 +' + st + '（方向空格 ' + empty + '）。');
                }
            });
            if (chargeNote && dmgMul === 1) logs.push(chargeNote + '。');
            if (!logs.length) logs.push('这支箭还没有效果。');
            if (s.nextPoison) {
                en.poison += s.nextPoison;
                logs.push('抹毒 中毒 +' + s.nextPoison + '。');
                s.nextPoison = 0;
            }
            logs.forEach(m => this.log(m));
            this.checkEnd();
            return { ok: true, msg: logs[0], consumed: false };
        }

        if (cat === 'shield') {
            const cost = cbt.energy != null ? cbt.energy : 1;
            if (s.shieldUsed) return { ok: false, msg: '这回合已经举过盾。' };
            if (s.energy < cost) return { ok: false, msg: '能量不够。' };
            s.energy -= cost;
            s.shieldUsed = true;
            s.usedShield = it;
            s.playerShield += cbt.shield || 0;
            const fx = ItemDB.combatEffects(it);
            const cap = fx.find(e => e && e.type === 'shield_cap_bonus');
            if (cap) s.playerShield += cap.value || 0;
            const intim = fx.find(e => e && e.type === 'intimidate');
            if (intim) s.intimidate = intim.atkReduce || 0;
            const mt = fx.find(e => e && e.type === 'melee_thorns');
            if (mt) s.meleeThorns = mt.value || 0;
            this.log('举起' + (it.name || '盾') + '，护盾 ' + s.playerShield
                + (s.intimidate ? ('，威压 -' + s.intimidate) : '') + '。');
            return { ok: true, msg: '举盾。', consumed: false };
        }

        if (cat === 'potion' || (cbt.heal && (def && def.use === 'consume'))) {
            return this.usePotion(it, cbt);
        }

        if (cat === 'weapon' || (cbt.dmg && cat !== 'armor')) {
            const cost = this.energyCost(it, cbt);
            if (s.energy < cost) return { ok: false, msg: '能量不够。' };
            const fx = ItemDB.combatEffects(it);
            const ignite = fx.find(e => e && e.type === 'ignite_all');
            const sweep = fx.find(e => e && e.type === 'aoe');
            const foes = (ignite || sweep) ? this.living() : (en ? [en] : []);
            if (!foes.length) return { ok: false, msg: '没有目标。' };
            s.energy -= cost;
            let lastNotes = [];
            let lastDmg = 0;
            let executed = false;
            const extraLogs = [];
            const coat = s.nextPoison || 0;
            if (coat) s.nextPoison = 0;
            foes.forEach(foe => {
                const exe = fx.find(e => e && e.type === 'execute');
                if (exe && foe.maxHp > 0 && foe.hp * 100 <= foe.maxHp * (exe.hpPct || 30)) {
                    foe.hp = 0;
                    foe.dead = true;
                    executed = true;
                    extraLogs.push((it.name || '武器') + '斩杀了' + foe.name + '。');
                    extraLogs.push.apply(extraLogs, this.applyWeaponExtras(it, foe, fx, false));
                    if (coat) {
                        foe.poison += coat;
                        extraLogs.push('抹毒 中毒 +' + coat + '。');
                    }
                    return;
                }
                const calc = this.computeWeaponDmg(it, foe);
                lastDmg = calc.dmg;
                lastNotes = calc.notes;
                const hadShield = foe.shield > 0;
                if ((ignite && ignite.shredShield) || fx.some(e => e && e.type === 'break_shield')) {
                    foe.shield = 0;
                }
                this.hit(foe, calc.dmg, false);
                if (ignite) foe.burn += ignite.stacks || 0;
                if (foe.hp <= 0) foe.dead = true;
                extraLogs.push.apply(extraLogs, this.applyWeaponExtras(it, foe, fx, hadShield));
                if (coat) {
                    foe.poison += coat;
                    extraLogs.push('抹毒 中毒 +' + coat + '。');
                }
            });
            const extra = lastNotes.length ? '（' + lastNotes.join('，') + '）' : '';
            if (executed) {
                extraLogs.forEach(m => this.log(m));
            } else {
                if (ignite) {
                    this.log((it.name || '油瓶') + '泼向全体，' + lastDmg + ' 伤'
                        + extra
                        + (ignite.shredShield ? '，削盾' : '')
                        + (ignite.stacks ? ('，燃烧 +' + ignite.stacks) : '') + '。');
                } else if (sweep) {
                    this.log((it.name || '镰刀') + '横扫全体，' + lastDmg + ' 伤' + extra + '。');
                } else {
                    this.log((it.name || '武器') + '打出 ' + lastDmg + ' 点' + extra + '。');
                    if (en && en.dead) this.log(en.name + '倒下了。');
                }
                extraLogs.forEach(m => this.log(m));
            }
            this.checkEnd();
            return this.useResult(it, executed ? '斩杀。' : (ignite ? '泼油。' : (sweep ? '横扫。' : '出招。')));
        }

        return { ok: false, msg: (it.name || '物品') + '现在点不了。' };
    },

    emptyDmgBonusFromOthers(except) {
        return this.trinketEmptyDmg();
    },

    energyCost(it, cbt) {
        if (ItemDB.isCombatConsumable(it)) return 0;
        return (cbt && cbt.energy) || 0;
    },

    useResult(it, msg) {
        const consumed = ItemDB.isCombatConsumable(it);
        if (consumed) {
            this.removeItem(it);
            this.log((it.name || '物品') + '用完了。');
        }
        return { ok: true, msg, consumed, item: consumed ? it : undefined };
    },

    removeItem(it) {
        const list = GameState.get('backpackItems', []) || [];
        GameState.set('backpackItems', list.filter(x => x !== it && x.id !== it.id));
    },

    pickBehavior(en) {
        const pool = en.behaviors || [];
        let sum = 0;
        pool.forEach(b => { sum += b.w || 1; });
        let r = Math.random() * (sum || 1);
        for (let i = 0; i < pool.length; i++) {
            r -= pool[i].w || 1;
            if (r <= 0) return pool[i];
        }
        return pool[0] || { type: 'attack', value: 4 };
    },

    doEnemyAct(en) {
        if (en.dead) return;
        if (en.stun > 0) {
            this.log(en.name + '眩晕，跳过。');
            return;
        }
        const b = this.pickBehavior(en);
        const skipExtra = this.runBehavior(en, b);
        if (b.extra && !skipExtra) this.runBehavior(en, b.extra);
    },

    runBehavior(en, b) {
        if (!b || en.dead) return false;
        if (b.type === 'attack') {
            const raw = b.value || 0;
            const val = Math.max(0, raw - (this.state.intimidate || 0));
            const n = this.state.log.length;
            this.hit('player', val, false, en);
            const dodged = this.state.log.slice(n).indexOf('闪避。') >= 0;
            if (!dodged) this.log(en.name + '打了你 ' + val + ' 点。');
            return dodged;
        } else if (b.type === 'block') {
            en.nextBlock += b.value || 0;
            this.log(en.name + '格挡，下回合盾 +' + (b.value || 0) + '。');
        } else if (b.type === 'heal') {
            en.hp = Math.min(en.maxHp, en.hp + (b.value || 0));
            this.log(en.name + '回了 ' + (b.value || 0) + ' 生命。');
        } else if (b.type === 'poison') {
            const n = b.value || b.stacks || 1;
            this.state.playerPoison = (this.state.playerPoison || 0) + n;
            this.log(en.name + '使你中毒 +' + n + '。');
        } else if (b.type === 'burn') {
            const n = b.value || b.stacks || 1;
            this.state.playerBurn = (this.state.playerBurn || 0) + n;
            this.log(en.name + '点燃了你 +' + n + '。');
        } else if (b.type === 'stun') {
            const chance = b.chance != null ? b.chance : 100;
            if (Math.random() * 100 < chance) {
                this.state.playerStun = Math.max(this.state.playerStun || 0, 1);
                this.state.playerStunAppliedTurn = this.state.turn;
                this.log(en.name + '把你打晕了。');
            }
        }
        return false;
    },

    enemyPhase() {
        const s = this.state;
        if (!s || s.finished || s.phase !== 'player') return { ok: false };
        s.phase = 'enemy';
        if (!(s.turn === 1 && s.firstStrike)) {
            s.enemies.forEach(en => this.doEnemyAct(en));
        }
        if (this.checkEnd()) return { ok: true, ended: true };
        this.statusPhase();
        if (this.checkEnd()) return { ok: true, ended: true };
        this.roundEnd();
        s.turn += 1;
        this.turnStart();
        return { ok: true };
    },

    statusPhase() {
        this.state.enemies.forEach(en => {
            if (en.dead) return;
            if (en.poison > 0) {
                this.hit(en, en.poison, true);
                this.log(en.name + '中毒 ' + en.poison + '。');
                en.poison -= 1;
            }
            if (en.burn > 0) {
                this.hit(en, en.burn, true);
                en.burnPenalty += 1;
                this.log(en.name + '燃烧 ' + en.burn + '。');
                en.burn -= 1;
            }
            if (en.stun > 0) en.stun -= 1;
            if (en.hp <= 0) en.dead = true;
        });
        const s = this.state;
        if (s.playerPoison > 0) {
            this.hit('player', s.playerPoison, true);
            this.log('你中毒 ' + s.playerPoison + '。');
            s.playerPoison -= 1;
        }
        if (s.playerBurn > 0) {
            this.hit('player', s.playerBurn, true);
            this.log('你燃烧 ' + s.playerBurn + '。');
            s.playerBurnPenalty = (s.playerBurnPenalty || 0) + 1;
            s.playerBurn -= 1;
        }
        if (s.playerStun > 0 && s.playerStunAppliedTurn !== s.turn) s.playerStun -= 1;
    },

    roundEnd() {
        const s = this.state;
        let add = 0;
        this.eachCombatEffect((e, it, cat) => {
            if (e.type === 'after_hit_next') {
                if (cat === 'armor' && s.hitThisTurn) add += e.shield || 0;
                if (cat === 'shield' && s.usedShield === it && s.hitThisTurn) add += e.shield || 0;
            }
            if (e.type === 'if_not_hit_next' && s.usedShield === it && !s.hitThisTurn) add += e.shield || 0;
            if (e.type === 'if_shield_held_next' && s.hadShieldAtTurnStart && !s.shieldBrokenThisTurn) {
                add += e.shield || 0;
            }
        });
        s.nextShield = add;
        s.playerShield = 0;
        s.enemies.forEach(en => { en.shield = 0; });
    },

    flee() {
        if (!this.state || this.state.finished) return;
        this.finish(false, true);
    }
};
