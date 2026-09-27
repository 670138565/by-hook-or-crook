/* =====================================================================
 * 主游戏场景（GameScene.js）
 * =====================================================================
 * 作用：玩家真正"玩"的地方——亨利在地图上走来走去。
 *
 * 现在的架构：
 *   1. WorldManager 读 world.json，把一张地图"搭"出来（背景/瓦片/建筑/墙/物品）
 *   2. 本场景负责：放玩家、摄像机、输入、互动派发、偷窃/拾取等行为
 *   3. 进哪张地图：传了 mapKey 就用传的；没传就读上次位置；没存档就用起始地图
 *
 * 可扩展性：切换地图只要 this.scene.start('GameScene', { mapKey: 'xxx' })
 *          （第9步出入口触发时会用到）
 * ===================================================================== */
class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: CONFIG.SCENES.GAME });
    }

    /**
     * init：场景启动时最先执行，接收外部参数
     * @param {object} data  { mapKey?: '地图代号', fromPortalId?: '从哪个出入口进来' }
     *                       不传 mapKey 则自动选图；传 fromPortalId 表示从出入口切换过来
     */
    init(data) {
        this.mapKey = data.mapKey || null;        // null = 自动选图
        this.fromPortalId = data.fromPortalId || null; // 从出入口进入时，目标出入口id
        this.spawnAt = (data && data.spawnX != null && data.spawnY != null)
            ? { x: data.spawnX, y: data.spawnY } : null;
        this.rollbackToast = !!(data && data.rollback);
        this.isStealing = false;                  // 是否正在偷窃（暂停互动检测）
        this.isTransitioning = false;             // 是否正在切换地图（淡出/确认框时冻结）
    }

    // create：搭建场景
    create() {
        // ---- 1. 决定进哪张地图 ----
        // 开局用起始地图+出生点。只有从出入口切过来时才用传入的 mapKey。
        // 不再读上次站的位置，否则刷新会站在门口/上一张图。
        let key = this.mapKey || WorldManager.getStartMap();
        if (!key || !WorldManager.world.maps[key]) {
            this.add.text(16, 16, '没有可用的地图，请先在编辑器里建一张地图', {
                fontSize: '20px', fill: '#ff0000'
            }).setScrollFactor(0).setDepth(50000);
            return;
        }

        // 对话异常退出时主场景可能仍暂停，进图时拉起来
        if (this.scene.isPaused()) this.scene.resume();

        // ---- 2. 用 WorldManager 搭建地图 ----
        // onInteract 是物品互动派发器：玩家按E时，按物品的 action 决定做什么
        const built = WorldManager.buildMap(this, key, (itemObj, itemData) => this.onItemInteract(itemObj, itemData));
        if (!built) return;
        this.currentMapKey = key;
        if (window.GameState && GameState.markVisitedMap) GameState.markVisitedMap(key);
        this.interactives = built.interactives;
        this.obstacles = built.obstacles;
        this.portals = built.portals;       // 出入口触发区列表
        this.zones = built.zones;           // 剧情触发区列表
        this.walkableRects = built.walkableRects || [];
        this.shapedWalls = built.shapedWalls || [];
        this.occluders = built.occluders || [];
        this._occPipe = OcclusionFadePipeline.ensure(this.game);
        this.applyAllChests();              // 按存档恢复「已开/已刷新」

        // ---- 3. 设置物理世界边界 = 地图大小（左上角可以不是 0,0）----
        this.physics.world.setBounds(built.x || 0, built.y || 0, built.width, built.height);

        // ---- 4. 创建玩家亨利 ----
        // 从出入口进来：脚底（碰撞盒中心）落在门口，再挪到墙外能走的点。
        // 不能把精灵中心直接放门口——脚在图下面，会嵌进门槛墙。
        let px = built.spawnX, py = built.spawnY;
        let fromPortal = false;
        if (this.spawnAt) {
            px = this.spawnAt.x;
            py = this.spawnAt.y;
        } else if (this.fromPortalId) {
            const arr = WorldManager.computeArrivalSpawn(key, this.fromPortalId);
            if (arr) { px = arr.x; py = arr.y; fromPortal = true; }
        }
        this.player = new Player(this, px, py, WorldManager.world.maps[key].playerScale);
        const mapCfg = WorldManager.world.maps[key];
        this._spawnPrefer = (mapCfg && mapCfg.spawn && isFinite(mapCfg.spawn.x))
            ? { x: mapCfg.spawn.x, y: mapCfg.spawn.y }
            : { x: (built.x || 0) + built.width / 2, y: (built.y || 0) + built.height / 2 };
        const off = WorldManager.playerBodyCenterOffset(this.player);
        const feetX = fromPortal ? px : (this.player.x + off.dx);
        const feetY = fromPortal ? py : (this.player.y + off.dy);
        const body = this.player.body;
        const half = body ? WorldManager.bodyHalfSize(body) : { hw: 12, hh: 12 };
        const free = WorldManager.snapSpawnFree(
            feetX, feetY,
            this.walkableRects, this.shapedWalls,
            this._spawnPrefer.x, this._spawnPrefer.y, half.hw, half.hh
        );
        WorldManager.placePlayerBodyAt(this.player, free.x, free.y);
        this.player.setCollideWorldBounds(true);
        this._walkX = this.player.x;
        this._walkY = this.player.y;
        this._onWalkablePost = () => this.constrainPlayerWalkable();
        this.events.on('postupdate', this._onWalkablePost);

        // ---- 5. 玩家与墙/实体建筑碰撞 ----
        this.physics.add.collider(this.player, this.obstacles);

        // ---- 6. 出入口：踩上去出提示，按 E 才进（不自动传送）----
        this.portalHint = this.add.text(0, 0, '按 E 进入', {
            fontFamily: (window.UiTheme && UiTheme.font) || '"Microsoft YaHei",sans-serif',
            fontSize: '14px',
            fill: (window.UiTheme && UiTheme.gold) || '#e0c078',
            backgroundColor: '#16120ecc',
            padding: { x: 8, y: 4 }
        }).setOrigin(0.5).setDepth(50000).setVisible(false);

        // ---- 6c. 剧情触发区检测（overlap，不挡路）----
        // 玩家走进剧情区时触发对应剧情。冷却防止站在里面反复触发。
        this.zoneCooldown = false;
        if (this.zones && this.zones.length > 0) {
            this.zones.forEach(z => {
                this.physics.add.overlap(this.player, z.body, () => this.onZoneOverlap(z.data));
            });
        }

        // ---- 7. 摄像机跟随亨利；小房间不铺满，四周留黑边 ----
        this.mapW = built.width;
        this.mapH = built.height;

        // ---- 8. HUD：左上资源 / 右上任务 / 左下操作 / 右下 BUFF ----
        const ui = window.UiTheme || {};
        const font = ui.font || '"Microsoft YaHei",sans-serif';
        const mapName = WorldManager.world.maps[key].name || key;
        this._hudMapName = mapName;

        this.hudResBg = this.add.graphics().setScrollFactor(0).setDepth(49990);
        this.hudRes = this.add.text(16, 16, '', ui.textStyle ? ui.textStyle({
            fontSize: '15px', fill: ui.gold || '#e0c078', lineSpacing: 4
        }) : {
            fontFamily: font, fontSize: '15px', fill: '#e0c078', padding: { x: 2, y: 2 }
        }).setOrigin(0, 0).setScrollFactor(0).setDepth(50000);

        this.hudQuestBg = this.add.graphics().setScrollFactor(0).setDepth(49990).setVisible(false);
        this.hudQuest = this.add.text(16, 48, '', ui.textStyle ? ui.textStyle({
            fontSize: '14px', fill: ui.sage || '#b7c9a3', align: 'left', lineSpacing: 5
        }) : {
            fontFamily: font, fontSize: '14px', fill: '#b7c9a3', align: 'left', lineSpacing: 5
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(50000);

        this.hudHintBg = this.add.graphics().setScrollFactor(0).setDepth(49990);
        this.hudHint = this.add.text(16, 16, '', ui.textStyle ? ui.textStyle({
            fontSize: '13px', fill: ui.muted || '#9a8f7e', lineSpacing: 3
        }) : {
            fontFamily: font, fontSize: '13px', fill: '#9a8f7e', lineSpacing: 3
        }).setOrigin(0, 1).setScrollFactor(0).setDepth(50000);

        this.hudBuffsBg = this.add.graphics().setScrollFactor(0).setDepth(49990).setVisible(false);
        this.hudBuffs = this.add.text(16, 16, '', ui.textStyle ? ui.textStyle({
            fontSize: '13px', fill: ui.wine || '#d4a5a5', align: 'right', lineSpacing: 5
        }) : {
            fontFamily: font, fontSize: '13px', fill: '#d4a5a5', align: 'right', lineSpacing: 5
        }).setOrigin(1, 1).setScrollFactor(0).setDepth(50000).setVisible(false);

        this.refreshHud = () => {
            if (this.hudRes) this.hudRes.setText(GameState.hudText());
            if (this.hudQuest) {
                let q = '';
                if (window.QuestDB) {
                    q = QuestDB.hudBlock ? QuestDB.hudBlock() : (QuestDB.hudLine ? QuestDB.hudLine() : '');
                }
                this.hudQuest.setText(q || '');
                const on = !!q;
                this.hudQuest.setVisible(on);
                this.hudQuest.setAlpha(on ? 1 : 0);
                if (this.hudQuestBg) this.hudQuestBg.setVisible(on);
            }
            if (this.hudHint) {
                this.hudHint.setText(
                    window.t('scene.' + this.currentMapKey + '.name', this._hudMapName || '地图') + '\n'
                    + window.t('ui.controlsHint', 'WASD 移动 · Shift 跑 · E 互动 · Tab 背包 · H 指引')
                );
            }
            this.refreshBuffHud();
            this.layoutHud();
        };
        this.refreshHud();
        this._onHud = () => this.refreshHud();
        EventBus.on('state:金币', this._onHud);
        EventBus.on('state:开锁器', this._onHud);
        EventBus.on('state:开锁技能', this._onHud);
        EventBus.on('state:生命', this._onHud);
        EventBus.on('state:生命上限', this._onHud);
        EventBus.on('state:等级', this._onHud);
        EventBus.on('state:经验', this._onHud);
        EventBus.on('state:通缉等级', this._onHud);
        EventBus.on('state:backpackItems', this._onHud);
        EventBus.on('state:timedBuffs', this._onHud);
        EventBus.on('quest:changed', this._onHud);

        this._onBattleResult = (r) => this.onBattleResult(r);
        EventBus.on('battle:result', this._onBattleResult);

        this.applyMapCamera();
        this.scale.on('resize', this.applyMapCamera, this);
        this.ensureNightOverlay();
        this.applySickLooks();

        // ---- 8. 监听偷窃小游戏的结果 ----
        // StealScene 结束时通过事件总线喊 'steal:result'，这里接收
        EventBus.once('steal:result', (result) => {
            this.onStealResult(result);
        });

        // 背包关闭：格子外物品掉地上，或正在开容器则进容器
        this._onBackpackClosed = (payload) => this.onBackpackClosed(payload);
        EventBus.on('backpack:closed', this._onBackpackClosed);
        this._onDialogueClosed = (p) => this.onDialogueClosed(p);
        EventBus.on('dialogue:closed', this._onDialogueClosed);

        // 把上次掉在这张地图上的物品重新生成出来
        this.spawnGroundDrops();
        this.containerContext = null;
        const fromRollback = !!this.rollbackToast;
        if (this.rollbackToast) {
            this.showToast('回到上次打赢的地方（通缉 ' + (GameState.wanted ? GameState.wanted() : 0) + '/' + (GameState.wantedMax ? GameState.wantedMax() : 3) + '）');
            this.rollbackToast = false;
        }

        // ---- 9. 监听按键 ----
        this.eKey = this.input.keyboard.addKey('E');
        this.tabKey = this.input.keyboard.addKey('TAB');
        this.hKey = this.input.keyboard.addKey('H');
        this.spaceKey = this.input.keyboard.addKey('SPACE');

        // 开局引导（首次；按 H 可再开）
        this._guideOpen = false;
        this._guideRoot = null;
        this._wantAskCdUntil = 0;
        this._wantAskNeedLeave = false;
        if (!fromRollback && GameState.isGuideDone && !GameState.isGuideDone()) {
            this.time.delayedCall(200, () => this.openGuide(true));
        }

        // ---- 10. W + Z + Y 三键同时按 → 打开总编辑器 ----
        // 用原生 DOM 键盘事件（window.open 必须在用户手势事件里调用，否则被弹窗拦截）
        this.editorKeys = { W: false, Z: false, Y: false };
        this.onEditorKeyDown = (e) => {
            const k = e.key.toUpperCase();
            if (k in this.editorKeys) this.editorKeys[k] = true;
            if (this.editorKeys.W && this.editorKeys.Z && this.editorKeys.Y && !this._editorOpened) {
                this._editorOpened = true;
                window.open('editor.html', '_blank');
                this.showToast('已打开总编辑器（新标签页）');
            }
        };
        this.onEditorKeyUp = (e) => {
            const k = e.key.toUpperCase();
            if (k in this.editorKeys) this.editorKeys[k] = false;
            if (!this.editorKeys.W || !this.editorKeys.Z || !this.editorKeys.Y) {
                this._editorOpened = false;
            }
        };
        window.addEventListener('keydown', this.onEditorKeyDown);
        window.addEventListener('keyup', this.onEditorKeyUp);

        // ---- 11. 场景关闭时：保存上次位置 + 清理键盘监听 ----
        this.events.once('shutdown', () => {
            this.scale.off('resize', this.applyMapCamera, this);
            if (this._onWalkablePost) this.events.off('postupdate', this._onWalkablePost);
            if (this.player) WorldManager.savePosition(this.currentMapKey, this.player.x, this.player.y);
            window.removeEventListener('keydown', this.onEditorKeyDown);
            window.removeEventListener('keyup', this.onEditorKeyUp);
            // 顺手清掉可能残留的确认框
            if (this._confirmBox) { this._confirmBox.remove(); this._confirmBox = null; }
            if (this._onBackpackClosed) EventBus.off('backpack:closed', this._onBackpackClosed);
            if (this._onDialogueClosed) EventBus.off('dialogue:closed', this._onDialogueClosed);
            if (this._onHud) {
                EventBus.off('state:金币', this._onHud);
                EventBus.off('state:开锁器', this._onHud);
                EventBus.off('state:开锁技能', this._onHud);
                EventBus.off('state:生命', this._onHud);
                EventBus.off('state:生命上限', this._onHud);
                EventBus.off('state:等级', this._onHud);
                EventBus.off('state:经验', this._onHud);
                EventBus.off('state:通缉等级', this._onHud);
                EventBus.off('state:backpackItems', this._onHud);
                EventBus.off('state:timedBuffs', this._onHud);
                EventBus.off('quest:changed', this._onHud);
            }
            if (this._onBattleResult) EventBus.off('battle:result', this._onBattleResult);
            (this.interactives || []).forEach(o => this.showNpcAlert(o, false));
            if (this.nightSpr) {
                this.nightSpr.destroy();
                this.nightSpr = null;
            }
            if (this.nightDim) {
                this.nightDim.destroy();
                this.nightDim = null;
            }
            if (this._tileStream) {
                this._tileStream.destroy();
                this._tileStream = null;
            }
        });
        this.events.once('destroy', () => {
            window.removeEventListener('keydown', this.onEditorKeyDown);
            window.removeEventListener('keyup', this.onEditorKeyUp);
        });

        // ---- 12. 进场淡入（从出入口切换过来时画面从黑变亮）----
        this.cameras.main.fadeIn(400, 0, 0, 0);

        // ---- 13. 主场景音乐（音频已在 PreloadScene 加载完，进图起 BGM）----
        if (window.AudioSys) AudioSys.playMusic(this, 'bgm_main');

        // 偷窃界面关掉、主游戏恢复后，如果刚才开锁成功，再打开容器背包
        this.events.on('resume', () => {
            if (window.QuestDB) {
                QuestDB.takeNotices().forEach(m => this.showToast(m));
            }
            this.flushPendingGroundLoot();
            if (!this._pendingContainer) return;
            const p = this._pendingContainer;
            this._pendingContainer = null;
            this.openContainer(p.obj, p.data);
        });
    }

    /** 任务/战斗发奖时背包塞不下的，掉脚边 */
    flushPendingGroundLoot() {
        if (!window.GameState || !GameState.takePendingGroundLoot) return;
        const ground = GameState.takePendingGroundLoot() || [];
        if (!ground.length) return;
        ground.forEach((it, i) => this.dropItemOnGround(it, i, ground.length));
        this.showToast(ground.length + '件奖励掉在脚边，放进格子才能带走');
    }

    /** 走出瓦片则退回；墙把人推出，合法位置才记成上一帧 */
    constrainPlayerWalkable() {
        const p = this.player;
        if (!p || !p.body) return;
        const lastX = this._walkX, lastY = this._walkY;
        const rects = this.walkableRects;
        const walls = this.shapedWalls;
        const onTile = () => !rects || !rects.length || WorldManager.isBodyCenterWalkable(p.body, rects);
        const inWall = () => walls && walls.length && WorldManager.bodyHitsAnyWall(p.body, walls);
        const valid = () => onTile() && !inWall();

        if (walls && walls.length) {
            WorldManager.constrainSpriteToShapedWalls(p, lastX, lastY, walls);
        }
        if (valid()) {
            this._walkX = p.x;
            this._walkY = p.y;
            return;
        }

        const ox = p.x, oy = p.y;
        const vx = p.body.velocity.x, vy = p.body.velocity.y;
        p.body.reset(lastX, oy);
        p.body.setVelocity(0, vy);
        if (walls && walls.length) WorldManager.constrainSpriteToShapedWalls(p, lastX, lastY, walls);
        if (valid()) {
            this._walkX = p.x;
            this._walkY = p.y;
            return;
        }
        p.body.reset(ox, lastY);
        p.body.setVelocity(vx, 0);
        if (walls && walls.length) WorldManager.constrainSpriteToShapedWalls(p, lastX, lastY, walls);
        if (valid()) {
            this._walkX = p.x;
            this._walkY = p.y;
            return;
        }
        p.body.reset(lastX, lastY);
        p.body.setVelocity(0, 0);
        if (walls && walls.length) WorldManager.constrainSpriteToShapedWalls(p, lastX, lastY, walls);
        if (!valid() && p.body) {
            const { hw, hh } = WorldManager.bodyHalfSize(p.body);
            const prefer = this._spawnPrefer || { x: lastX, y: lastY };
            const free = WorldManager.snapSpawnFree(
                p.body.center.x, p.body.center.y,
                rects, walls, prefer.x, prefer.y, hw, hh
            );
            WorldManager.placePlayerBodyAt(p, free.x, free.y);
        }
        this._walkX = p.x;
        this._walkY = p.y;
    }

    /** 亨利周围一圈：挡在他前面的图在圈里变淡 */
    refreshOcclusionFade() {
        const p = this.player;
        if (!p || !this.occluders) return;
        const baseR = CONFIG.OCCLUSION_FADE_RADIUS || 100;
        const baseScale = CONFIG.PLAYER_SCALE || 0.5;
        const pScale = (p.playerScale > 0) ? p.playerScale : baseScale;
        const r = baseR * (pScale / baseScale);
        const fade = CONFIG.OCCLUSION_FADE_ALPHA != null ? CONFIG.OCCLUSION_FADE_ALPHA : 0.6;
        const pipe = this._occPipe;
        const cam = this.cameras.main;
        const view = cam.worldView;
        const sx = view.width ? ((p.x - view.x) / view.width) * cam.width : 0;
        const sy = view.height ? ((p.y - view.y) / view.height) * cam.height : 0;
        const bufH = (this.game.renderer && this.game.renderer.height)
            || (this.game.canvas && this.game.canvas.height)
            || cam.height;
        OcclusionFadePipeline.px = sx;
        OcclusionFadePipeline.py = bufH - sy;
        OcclusionFadePipeline.radius = r * cam.zoom;
        OcclusionFadePipeline.alpha = fade;
        if (pipe) {
            pipe.set2f('uPlayer', OcclusionFadePipeline.px, OcclusionFadePipeline.py);
            pipe.set1f('uRadius', OcclusionFadePipeline.radius);
            pipe.set1f('uAlpha', fade);
        }
        const feet = p.body ? p.body.bottom : (p.y + p.displayHeight * 0.5);
        this.refreshOccluderDepths(feet);
        for (let i = 0; i < this.occluders.length; i++) {
            const s = this.occluders[i];
            if (!s || !s.active) continue;
            // 用遮挡线比前后。淡入淡出留一点空隙，避免脚在线上时每帧闪
            const sortY = (s._sortY != null && isFinite(s._sortY)) ? s._sortY : s.y;
            const slack = 3;
            let covering;
            if (s._occOn) covering = feet < sortY + slack && GameScene.circleHitsOccluder(p.x, p.y, r, s);
            else covering = feet < sortY - slack && GameScene.circleHitsOccluder(p.x, p.y, r, s);
            if (pipe) {
                if (covering) {
                    if (s._occOn !== true) {
                        s.setPipeline(pipe);
                        s._occOn = true;
                        this.restoreSpriteTint(s);
                    }
                    s._occFade = fade;
                    if (s.alpha !== 1) s.setAlpha(1);
                } else if (s._occOn) {
                    s.resetPipeline();
                    s._occFade = 1;
                    s._occOn = false;
                    this.restoreSpriteTint(s);
                }
            } else {
                s.setAlpha(covering ? fade : 1);
            }
        }
    }

    /**
     * 亨利和摆件都按脚底 Y 排序。不要按「人在线前/线后」整层跳 10000/30000：
     * 那样亨利一上下走，两件家具会互相抢前后，图层就乱跳。
     */
    refreshOccluderDepths(feet) {
        const p = this.player;
        if (!p || !this.occluders) return;
        const playerDepth = WorldManager.ySortDepth(feet) + 0.5;
        p.setDepth(playerDepth);
        if (p.shadow) p.shadow.setDepth(playerDepth - 0.1);
        for (let i = 0; i < this.occluders.length; i++) {
            const s = this.occluders[i];
            if (!s || !s.active) continue;
            const sortY = (s._sortY != null && isFinite(s._sortY)) ? s._sortY : s.y;
            const z = (s._z != null && isFinite(s._z)) ? s._z : 0;
            s.setDepth(WorldManager.ySortDepth(sortY) + WorldManager.layerZ(z));
        }
    }

    static circleHitsOccluder(cx, cy, r, spr) {
        let left, top, w, h;
        if (spr._occW > 0 && spr._occH > 0) {
            left = spr._occLeft;
            top = spr._occTop;
            w = spr._occW;
            h = spr._occH;
        } else {
            left = spr.x - spr.displayWidth * spr.originX;
            top = spr.y - spr.displayHeight * spr.originY;
            w = spr.displayWidth;
            h = spr.displayHeight;
        }
        const nx = Math.max(left, Math.min(cx, left + w));
        const ny = Math.max(top, Math.min(cy, top + h));
        const dx = cx - nx, dy = cy - ny;
        return dx * dx + dy * dy <= r * r;
    }

    /** 镜头跟着亨利。亨利在屏幕上的大小锁死，不因房间小而拉近。 */
    applyMapCamera() {
        if (!this.mapW || !this.mapH) return;
        const cam = this.cameras.main;
        if (typeof cam.removeBounds === 'function') cam.removeBounds();
        else cam.useBounds = false;
        const map = this.currentMapKey && WorldManager.world.maps[this.currentMapKey];
        const base = CONFIG.PLAYER_SCALE || 0.5;
        const pScale = (map && map.playerScale > 0) ? map.playerScale : base;
        const want = CONFIG.CAMERA_MIN_ZOOM != null ? CONFIG.CAMERA_MIN_ZOOM : 1.25;
        let zoom = want * (base / pScale);
        // 缩放到 128 的倍数，亨利不会落在半像素上
        zoom = Math.round(zoom * 128) / 128;
        if (!(zoom > 0)) zoom = want;
        cam.setRoundPixels(true);
        cam.setZoom(zoom);
        if (this.player) cam.startFollow(this.player, true, 1, 1);
        this.layoutHud(zoom);
        this.updateNightOverlay();
        if (this._tileStream) this._tileStream.update();
    }

    /**
     * 屏幕 UI 不跟镜头缩放：位置按屏幕像素，大小保持原字号。
     * Phaser 的 scrollFactor(0) 仍会被 camera.zoom 放大缩小。
     */
    pinToScreen(obj, screenX, screenY, zoom) {
        if (!obj || !(zoom > 0)) return;
        const cam = this.cameras.main;
        const midX = cam.width * 0.5;
        const midY = cam.height * 0.5;
        obj.setScale(1 / zoom);
        obj.setPosition(
            midX + (screenX - midX) / zoom,
            midY + (screenY - midY) / zoom
        );
    }

    layoutHud(zoom) {
        const z = zoom || (this.cameras.main && this.cameras.main.zoom) || 1;
        const cam = this.cameras.main;
        if (!cam) return;
        const pad = 18;
        const H = cam.height;
        const W = cam.width;
        const ui = window.UiTheme;

        if (this.hudRes) {
            if (this.hudResBg && ui && ui.paintPanel) ui.paintPanel(this.hudResBg, this.hudRes.width, this.hudRes.height, 10);
            this.pinToScreen(this.hudResBg, pad, pad, z);
            this.pinToScreen(this.hudRes, pad, pad, z);
        }
        if (this.hudQuest && this.hudQuest.alpha > 0) {
            if (this.hudQuestBg && ui && ui.paintPanel) {
                ui.paintPanel(this.hudQuestBg, this.hudQuest.width, this.hudQuest.height, 10);
                this.hudQuestBg.setVisible(true);
            }
            // origin 1,0：锚在右上，graphics 本地 0,0 是文字左上，应对齐到 (W-pad - width, pad)
            const qx = W - pad - (this.hudQuest.width || 0);
            const qy = pad;
            this.pinToScreen(this.hudQuestBg, qx, qy, z);
            this.pinToScreen(this.hudQuest, W - pad, pad, z);
        } else if (this.hudQuestBg) {
            this.hudQuestBg.clear();
            this.hudQuestBg.setVisible(false);
        }
        if (this.hudHint) {
            if (this.hudHintBg && ui && ui.paintPanel) ui.paintPanel(this.hudHintBg, this.hudHint.width, this.hudHint.height, 10);
            const hx = pad;
            const hy = H - pad - (this.hudHint.height || 0);
            this.pinToScreen(this.hudHintBg, hx, hy, z);
            this.pinToScreen(this.hudHint, pad, H - pad, z);
        }
        if (this.hudBuffs && this.hudBuffs.visible) {
            if (this.hudBuffsBg && ui && ui.paintPanel) {
                ui.paintPanel(this.hudBuffsBg, this.hudBuffs.width, this.hudBuffs.height, 10);
                this.hudBuffsBg.setVisible(true);
            }
            const bx = W - pad - (this.hudBuffs.width || 0);
            const by = H - pad - (this.hudBuffs.height || 0);
            this.pinToScreen(this.hudBuffsBg, bx, by, z);
            this.pinToScreen(this.hudBuffs, W - pad, H - pad, z);
        } else if (this.hudBuffsBg) {
            this.hudBuffsBg.clear();
            this.hudBuffsBg.setVisible(false);
        }
    }

    refreshBuffHud() {
        if (!this.hudBuffs || !window.GameState || !GameState.timedBuffLines) return;
        const lines = GameState.timedBuffLines() || [];
        if (!lines.length) {
            this.hudBuffs.setText('');
            this.hudBuffs.setVisible(false);
            if (this.hudBuffsBg) {
                this.hudBuffsBg.clear();
                this.hudBuffsBg.setVisible(false);
            }
            return;
        }
        this.hudBuffs.setText(lines.join('\n'));
        this.hudBuffs.setVisible(true);
    }

    // update：每帧调用
    update() {
        GameState.addGameTime(this.game.loop.delta);
        if (window.QuestDB && QuestDB.takeNotices) {
            QuestDB.takeNotices().forEach(m => this.showToast(m));
        }
        this.updateNightOverlay();
        this.refreshDayHud();
        // 限时 BUFF 倒计时：每秒刷新右下角列表
        const buffSec = Math.floor(Date.now() / 1000);
        if (this._buffHudSec !== buffSec) {
            this._buffHudSec = buffSec;
            this.refreshBuffHud();
            this.layoutHud();
        }
        this.maybeRefreshChests();
        this.maybeRefreshShops();
        this.maybeNpcTakeFood();
        // 切换中（淡出/确认框）冻结玩家移动，也不检测互动
        if (this.isTransitioning || this._guideOpen) {
            if (this.player) this.player.body.setVelocity(0);
            if (this._guideOpen) this._pollGuideKeys();
            return;
        }

        if (this.player) this.player.update();
        if (this._tileStream) this._tileStream.update();
        this.updateNpcAi(this.game.loop.delta);

        // 新手教程推进（气泡提示）
        if (this.tut) this.tut.update(this.game.loop.delta);

        // ---- 更新可互动物体：范围内只高亮最近的那一个 ----
        // 还没捡背包：只能和"给你背包"的那件互动，其它东西不亮、按E没反应
        const hasBag = GameState.get('hasBackpack', false);
        let nearest = null;
        let nearestDist = Infinity;
        if (this.interactives && !this.isStealing) {
            for (const obj of this.interactives) {
                obj.update(this.player);
                const allowed = hasBag || this.isStarterBackpack(obj) || this.isDialogueNpc(obj);
                if (obj.inRange && allowed) {
                    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, obj.x, obj.y);
                    if (d < nearestDist) {
                        nearestDist = d;
                        nearest = obj;
                    }
                }
            }
            for (const obj of this.interactives) {
                obj.setFocused(obj === nearest);
            }
        }

        const standingPortal = this.findStandingPortal();
        this.refreshPortalHint(standingPortal);
        if (standingPortal) {
            for (const obj of this.interactives) obj.setFocused(false);
            nearest = null;
        }

        // ---- 按E：站在出入口上则进入；否则互动最近的物体 ----
        if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
            if (standingPortal) this.tryEnterPortal(standingPortal.data);
            else if (nearest) nearest.tryInteract();
        }

        // ---- 按 Tab 打开背包（只有解锁了背包才能开）----
        if (Phaser.Input.Keyboard.JustDown(this.tabKey)) {
            this.openBackpack();
        }
        if (Phaser.Input.Keyboard.JustDown(this.hKey)) {
            this.openGuide(false);
        }

        this.refreshOcclusionFade();
    }

    /**
     * 物品互动派发器：根据物品的 action 决定做什么
     * @param {InteractiveObject} itemObj  被互动的物体
     * @param {object} itemData              物品配置数据
     */
    /** 开局必须先捡的那件背包（grant === 'backpack'） */
    isStarterBackpack(obj) {
        return !!(obj && obj.itemData && obj.itemData.grant === 'backpack');
    }

    isDialogueNpc(obj) {
        return !!(obj && obj.itemData && obj.itemData.action === 'dialogue');
    }

    onItemInteract(itemObj, itemData) {
        if (!GameState.get('hasBackpack', false) && itemData.grant !== 'backpack' && itemData.action !== 'dialogue') {
            this.showToast('先拾取背包，才能互动');
            return;
        }
        switch (itemData.action) {
            case 'steal':
                this.startStealing(itemObj);
                break;
            case 'pickup':
                this.pickupItem(itemObj, itemData);
                break;
            case 'open':
                this.openContainer(itemObj, itemData);
                break;
            case 'shop':
                this.openShop(itemData);
                break;
            case 'dialogue':
                this.openDialogue(itemData);
                break;
            default:
                this.showToast('这个物品没有互动行为');
        }
    }

    /* =====================================================================
     * 出入口：踩上去提示，按 E 进入
     * ===================================================================== */

    findStandingPortal() {
        if (!this.player || !this.portals || !this.portals.length) return null;
        if (this.isStealing || this.isTransitioning) return null;
        for (let i = 0; i < this.portals.length; i++) {
            const p = this.portals[i];
            if (!p || !p.body || !p.data) continue;
            if (!p.data.targetMap || !p.data.targetPortalId) continue;
            if (this.physics.world.overlap(this.player, p.body)) return p;
        }
        return null;
    }

    refreshPortalHint(portal) {
        if (!this.portalHint) return;
        if (!portal || !this.player) {
            this.portalHint.setVisible(false);
            return;
        }
        const map = WorldManager.world.maps[portal.data.targetMap];
        const name = map ? (map.name || portal.data.targetMap) : '';
        this.portalHint.setText(name ? ('按 E 进入' + name) : '按 E 进入');
        this.portalHint.setPosition(this.player.x, this.player.y - this.player.displayHeight * 0.55);
        this.portalHint.setVisible(true);
    }

    /* =====================================================================
     * 剧情触发区相关
     * ===================================================================== */

    /**
     * 玩家踩进剧情区时调用（overlap 检测）
     * @param {object} zoneData  剧情区配置 {id, name, once, ...}
     */
    onZoneOverlap(zoneData) {
        if (window.QuestDB) QuestDB.markZone(zoneData);
        // 冷却中 / 切换中 / 偷窃中 → 忽略
        if (this.zoneCooldown || this.isTransitioning || this.isStealing) return;
        // "只一次"且已触发过 → 永久忽略
        if (zoneData.once && WorldManager.isZoneTriggered(this.currentMapKey, zoneData.id)) return;
        // 触发剧情
        this.triggerStory(zoneData);
    }

    /**
     * 触发剧情：按 zone.name 分发到具体剧情代码
     * 现在只有占位提示，后续每种剧情在这里加 case
     * @param {object} zoneData
     */
    triggerStory(zoneData) {
        // "只一次"的剧情：标记为已触发（永久不再触发）
        if (zoneData.once) {
            WorldManager.markZoneTriggered(this.currentMapKey, zoneData.id);
        }
        // "每次"的剧情：短暂冷却，避免站在里面反复弹
        this.zoneCooldown = true;
        this.time.delayedCall(1500, () => { this.zoneCooldown = false; });

        // 按 name 分发到具体剧情
        switch (zoneData.name) {
            case '剧情1':
                this.playSaltCircleStory();
                break;
            default:
                this.showToast('🎬 触发剧情：' + (zoneData.name || '未命名') + (zoneData.once ? '（一次性）' : '（每次）'));
        }
    }

    /** 盐圈封印鬼：对话 + 2 分钟附身 BUFF */
    playSaltCircleStory() {
        if (window.GameState && GameState.addTimedBuff) {
            GameState.addTimedBuff({
                id: 'salt_ghost',
                name: '鬼气附身',
                ms: 2 * 60 * 1000,
                damage: 100,
                suspicion: 100,
                stealth: -100
            });
            if (this.refreshHud) this.refreshHud();
            this.showToast('鬼气附身 2 分钟：伤害+100，可疑度+100，潜行-100');
        }
        const def = window.DialogueDB && DialogueDB.makeSaltCircleDef
            ? DialogueDB.makeSaltCircleDef()
            : null;
        if (!def) return;
        if (this.scene.isActive(CONFIG.SCENES.DIALOGUE) || this.scene.isActive(CONFIG.SCENES.SHOP)
            || this.scene.isActive(CONFIG.SCENES.BACKPACK) || this.scene.isActive(CONFIG.SCENES.BATTLE)
            || this.scene.isActive(CONFIG.SCENES.STEAL)) {
            return;
        }
        this.scene.pause();
        this.scene.launch(CONFIG.SCENES.DIALOGUE, { dialogue: def, itemData: null });
    }

    /**
     * 按 E 进入出入口
     */
    tryEnterPortal(portalData) {
        if (this.isTransitioning || this.isStealing) return;
        if (!portalData.targetMap || !portalData.targetPortalId) return;
        if (!GameState.get('hasBackpack', false)) {
            this.showToast('先拾取背包，才能前往其它地方');
            return;
        }
        const targetMap = WorldManager.world.maps[portalData.targetMap];
        const targetName = targetMap ? (targetMap.name || portalData.targetMap) : portalData.targetMap;
        if (!targetMap) { this.showToast('目标地图不存在：' + portalData.targetMap); return; }
        this.doPortalTransition(portalData.targetMap, portalData.targetPortalId, targetName);
    }

    /**
     * 显示出入口确认框（用 DOM 浮层，比 Phaser 原生 UI 好看）
     * @param {object} portalData
     * @param {string} targetName  目标地图名
     */
    showPortalConfirm(portalData, targetName) {
        // 防止重复弹
        if (this._confirmBox) return;
        this.isTransitioning = true;  // 切换中，冻结移动（暂停玩家输入）

        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:#1e1e2e;border:2px solid #cba6f7;border-radius:12px;padding:24px 32px;color:#cdd6f4;font-family:sans-serif;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.6);text-align:center;min-width:280px;';
        box.innerHTML = `
            <div style="font-size:20px;margin-bottom:8px;">🚪 要前往 <b style="color:#cba6f7;">${targetName}</b> 吗？</div>
            <div style="font-size:13px;color:#a6adc8;margin-bottom:18px;">（两侧名字前后各留空格，方便阅读）</div>
            <div style="display:flex;gap:12px;justify-content:center;">
                <button id="pc-yes" style="background:#a6e3a1;color:#1e1e2e;border:none;border-radius:8px;padding:8px 24px;font-size:16px;font-weight:bold;cursor:pointer;">是</button>
                <button id="pc-no" style="background:#45475a;color:#cdd6f4;border:none;border-radius:8px;padding:8px 24px;font-size:16px;cursor:pointer;">否</button>
            </div>
        `;
        document.body.appendChild(box);
        this._confirmBox = box;

        const close = () => {
            box.remove();
            this._confirmBox = null;
            this.isTransitioning = false;
        };
        box.querySelector('#pc-yes').onclick = () => {
            close();
            this.doPortalTransition(portalData.targetMap, portalData.targetPortalId, targetName);
        };
        box.querySelector('#pc-no').onclick = () => {
            close();
            // 选"否"：短暂冷却，避免玩家还站在触发区里立刻又弹
            this.portalCooldown = true;
            this.time.delayedCall(1500, () => { this.portalCooldown = false; });
        };
    }

    /**
     * 执行地图切换：淡出 → 启动新场景（带 fromPortalId）→ 新场景淡入
     * @param {string} targetMap       目标地图 key
     * @param {string} targetPortalId  目标出入口 id
     * @param {string} targetName      目标地图名（提示用）
     */
    doPortalTransition(targetMap, targetPortalId, targetName) {
        if (this.isTransitioning) return;
        this.isTransitioning = true;
        if (this.portalHint) this.portalHint.setVisible(false);
        if (window.AudioSys) AudioSys.sfx(this, 'sfx_open_door');
        this.showToast('前往 ' + targetName + ' ...');
        // 离开出生图：结束新手教程（未完成也视为已引导）
        if (window.TutSys && TutSys.isTeaching()) TutSys.finish();
        this.tut = null;
        // 摄像机淡出 400ms，完成后切换场景
        this.cameras.main.fadeOut(400, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => {
            // 切换到新地图，传入 fromPortalId 让新场景算落地坐标
            this.scene.start(CONFIG.SCENES.GAME, {
                mapKey: targetMap,
                fromPortalId: targetPortalId
            });
        });
    }

    /**
     * 开始偷窃：暂停主游戏，弹出偷窃小游戏场景
     */
    startStealing(box) {
        const picks = GameState.get('开锁器', 0) || 0;
        const keys = GameState.usableKeys ? GameState.usableKeys(box.lockLevel) : [];
        if (picks <= 0 && !keys.length) {
            this.showToast('没有开锁器，也没有能用的钥匙');
            return;
        }
        this.isStealing = true;
        box.prompt.setVisible(false);
        box.disableHighlight();
        this.scene.pause();
        this.scene.launch(CONFIG.SCENES.STEAL, {
            target: box,
            lockLevel: box.lockLevel
        });
    }

    /**
     * 拾取物品：从地图消失，永久获得
     * @param {InteractiveObject} itemObj
     * @param {object} itemData
     */
    pickupItem(itemObj, itemData) {
        // 拾取音效（Grab）
        if (window.AudioSys) AudioSys.sfx(this, 'sfx_grab');

        // 从可互动列表移除
        const idx = this.interactives.indexOf(itemObj);
        if (idx >= 0) this.interactives.splice(idx, 1);
        // 销毁显示对象和提示
        itemObj.prompt.destroy();
        itemObj.disableHighlight();
        itemObj.destroy();

        // 地上掉落物：从记录里删掉，避免切图后又刷出来
        if (itemData.id) GameState.removeGroundDrop(this.currentMapKey, itemData.id);
        // 地图上摆的拾取物：记下来，再进这张图不要刷回去
        if (itemData.id && GameState.markPickedMapItem) {
            GameState.markPickedMapItem(this.currentMapKey, itemData.id);
        }

        // 按 grant 标记解锁对应功能
        if (itemData.grant === 'backpack') {
            GameState.initBackpack();   // 解锁背包 + 初始格子
            this.showToast('拾取了 ' + (itemData.name || '物品') + '！已解锁背包，按 Tab 打开');
        } else if (itemData.grant === 'key') {
            GameState.set('hasKey', true);
            this.showToast('拾取了 ' + (itemData.name || '钥匙'));
        } else if (itemData.grant === 'lockpick' || (window.ItemDB && ItemDB.isLockpickResource(itemData.defId || itemData))) {
            const n = itemData.grantValue || (window.ItemDB ? ItemDB.lockpickAmount(itemData.defId || itemData) : 1) || 1;
            const left = GameState.gainLockpicks(n);
            this.showToast('开锁器 +' + n + '（现有 ' + left + '）');
        } else if (GameState.get('hasBackpack', false)) {
            // 捡进背包格子外。暂存满了（开局上限是0）就立刻打开背包整理
            GameState.addBackpackItem({
                id: itemData.id,
                defId: itemData.defId,
                image: itemData.image,
                name: itemData.name,
                w: itemData.wCells || 1,
                h: itemData.hCells || 1,
                rot: itemData.rot || 0,
                rarity: itemData.rarity || 'common',
                poisoned: !!itemData.poisoned
            });
            const loose = GameState.countLooseItems();
            const stash = GameState.get('backpackStashSlots', 0);
            const pickName = (window.ItemDB && ItemDB.displayName) ? ItemDB.displayName(itemData) : (itemData.name || '物品');
            if (loose > stash) {
                this.openBackpack(null, { skipToast: true });
                this.showToast(stash <= 0
                    ? '把物品放进格子才能带走，否则会掉在地上'
                    : '暂存已满（' + stash + '），先整理背包');
            } else {
                this.showToast('暂存了 ' + pickName + '（' + loose + '/' + stash + '）');
            }
        } else {
            this.showToast('拾取了 ' + (itemData.name || '物品'));
        }
    }

    /**
     * 打开背包
     * @param {object|null} containerContext  正在开容器时传入 {id, name}
     * @param {object} [opts]  { skipToast: true } 捡东西强制打开时不重复提示
     */
    openBackpack(containerContext, opts) {
        if (!GameState.get('hasBackpack', false)) {
            this.showToast('还没有背包，先去拾取一个背包');
            return;
        }
        // 打开背包音效
        if (window.AudioSys) AudioSys.sfx(this, 'sfx_open_inventory');
        if (window.TutSys) TutSys.notify('openedBackpack');
        if (this.scene.isActive(CONFIG.SCENES.BACKPACK) || this.scene.isActive(CONFIG.SCENES.SHOP)
            || this.scene.isActive(CONFIG.SCENES.BATTLE) || this.scene.isActive(CONFIG.SCENES.DIALOGUE)) return;
        this.containerContext = containerContext || null;
        this.scene.pause();
        this.scene.launch(CONFIG.SCENES.BACKPACK, {
            fromContainer: !!containerContext,
            containerId: containerContext ? containerContext.id : null,
            containerName: containerContext ? (containerContext.name || '容器') : '',
            lockLevel: containerContext ? (containerContext.lockLevel || 1) : 1
        });
        if (opts && opts.skipToast) return;
        this.showToast(containerContext ? ('打开了 ' + (containerContext.name || '容器')) : '打开了背包');
    }

    /**
     * 打开容器：把容器里已有物品拿到格子外，再打开背包（关闭时格子外的会放回去）
     */
    openContainer(itemObj, itemData) {
        if (!GameState.get('hasBackpack', false)) {
            this.showToast('还没有背包，先去拾取一个背包');
            return;
        }
        // 开箱音效：按锁等级播对应箱子声（1木 2铁 3金）
        if (window.AudioSys) {
            const lv = itemData.lockLevel || 1;
            const k = lv >= 3 ? 'sfx_open_gold' : (lv === 2 ? 'sfx_open_iron' : 'sfx_open_wood');
            AudioSys.sfx(this, k);
        }
        const id = window.LootDB ? LootDB.containerId(this.currentMapKey, itemData)
            : (itemData.id || ('c_' + (itemData.name || 'box')));
        GameState.ensureContainer(id, itemData.name || '容器');
        this.applyQuestLoot(itemData);
        this.openBackpack({
            id: id,
            name: itemData.name || '容器',
            lockLevel: itemData.lockLevel || 1
        });
    }

    openDialogue(itemData) {
        if (!window.DialogueDB) {
            this.showToast('对话还没准备好');
            return;
        }
        const nid = this.npcIdOfData(itemData);
        if (nid && GameState.isNpcSick && GameState.isNpcSick(nid)) {
            this.showToast((itemData && itemData.name || '这人') + '病得起不来床');
            return;
        }
        // 店主：NPC 定义了 shopId 就直接进商店，不展开对话
        if (nid && DialogueDB.get) {
            const npcDef = DialogueDB.get(nid);
            if (npcDef && npcDef.shopId) {
                if (this.scene.isActive(CONFIG.SCENES.SHOP) || this.scene.isActive(CONFIG.SCENES.BACKPACK)
                    || this.scene.isActive(CONFIG.SCENES.BATTLE) || this.scene.isActive(CONFIG.SCENES.STEAL)) return;
                this.openShop(Object.assign({}, itemData, {
                    shopId: npcDef.shopId,
                    name: npcDef.name || itemData.name
                }));
                return;
            }
        }
        const def = DialogueDB.forItem(itemData);
        if (!def) {
            this.showToast('这个人还没有台词');
            return;
        }
        if (DialogueDB.hasSpeakable && !DialogueDB.hasSpeakable(def)) {
            const who = (itemData && itemData.name) || def.name || '这个人';
            this.showToast(who + '还没有台词');
            return;
        }
        if (this.scene.isActive(CONFIG.SCENES.DIALOGUE) || this.scene.isActive(CONFIG.SCENES.SHOP)
            || this.scene.isActive(CONFIG.SCENES.BACKPACK) || this.scene.isActive(CONFIG.SCENES.BATTLE)) return;
        this.scene.pause();
        this.scene.launch(CONFIG.SCENES.DIALOGUE, { dialogue: def, itemData: itemData });
    }

    tryCaughtTalk(obj) {
        if (!obj || !obj._ai || obj._ai.confronted) return;
        if (!this.player) return;
        const st = CONFIG.STEAL || {};
        const nearNpc = Phaser.Math.Distance.Between(this.player.x, this.player.y, obj.x, obj.y) <= this.worldRange((GameState.spotRange && GameState.spotRange()) || st.SPOT_RANGE || 110);
        const nx = obj._ai.noiseX, ny = obj._ai.noiseY;
        const nearNoise = isFinite(nx) && Phaser.Math.Distance.Between(this.player.x, this.player.y, nx, ny) <= this.worldRange(140);
        if (!nearNpc || !nearNoise) return;
        if (this.scene.isActive(CONFIG.SCENES.DIALOGUE) || this.scene.isActive(CONFIG.SCENES.BATTLE)
            || this.scene.isActive(CONFIG.SCENES.STEAL) || this.scene.isActive(CONFIG.SCENES.BACKPACK)) return;
        obj._ai.confronted = true;
        const data = obj.itemData || {};
        const def = DialogueDB.makeCaughtDef
            ? DialogueDB.makeCaughtDef(this.npcName(obj), data.dialogueId || data.npcId || '', '')
            : null;
        if (!def) return;
        this.scene.pause();
        this.scene.launch(CONFIG.SCENES.DIALOGUE, {
            dialogue: def,
            itemData: data,
            caught: true,
            caughtItemId: data.id || ''
        });
    }

    isGuardNpc(obj) {
        if (!window.DialogueDB || !DialogueDB.isGuard) return false;
        return DialogueDB.isGuard(this.npcIdOf(obj));
    }

    wantedChaseSpec(level) {
        if (level >= 2) return { see: 340, leash: 640, catch: 110, speed: 1.35 };
        if (level >= 1) return { see: 220, leash: 380, catch: 110, speed: 1 };
        return null;
    }

    resumeNpcPatrol(obj) {
        if (!obj) return;
        this.showNpcAlert(obj, false);
        this.setShout(obj, false);
        obj._ai = null;
    }

    startWantedChase(obj, spec) {
        if (obj._homeX == null) {
            obj._homeX = obj.x;
            obj._homeY = obj.y;
        }
        obj._ai = {
            mode: 'chase',
            tx: this.player.x,
            ty: this.player.y,
            ox: obj.x,
            oy: obj.y,
            stuck: 0,
            chaseSpeed: spec.speed || 1,
            confronted: false
        };
        this.showNpcAlert(obj, true);
        this.showToast(this.npcName(obj) + '朝你追来');
    }

    openWantedAsk(obj) {
        if (!obj || !this.player || !window.DialogueDB || !DialogueDB.makeWantedAskDef) return;
        if (this.scene.isActive(CONFIG.SCENES.DIALOGUE) || this.scene.isActive(CONFIG.SCENES.BATTLE)
            || this.scene.isActive(CONFIG.SCENES.STEAL) || this.scene.isActive(CONFIG.SCENES.BACKPACK)
            || this.scene.isActive(CONFIG.SCENES.SHOP)) return;
        obj._wantHold = true;
        if (obj._homeX == null) {
            obj._homeX = obj.x;
            obj._homeY = obj.y;
        }
        const data = obj.itemData || {};
        const id = this.npcIdOf(obj);
        const npc = DialogueDB.get(id);
        const kind = DialogueDB.guardKind ? DialogueDB.guardKind(id) : 'guard';
        const def = DialogueDB.makeWantedAskDef(
            (npc && npc.name) || this.npcName(obj),
            id,
            (npc && npc.portrait) || '',
            kind
        );
        this.scene.pause();
        this.scene.launch(CONFIG.SCENES.DIALOGUE, {
            dialogue: def,
            itemData: data,
            caught: true,
            caughtItemId: data.id || ''
        });
    }

    updateWantedGuard(obj) {
        if (!obj || !this.isGuardNpc(obj) || !this.player) return;
        const w = GameState.wanted ? GameState.wanted() : 0;
        const spec = this.wantedChaseSpec(w);
        const ai = obj._ai;
        if (!spec) {
            if (ai && ai.mode === 'chase') this.resumeNpcPatrol(obj);
            obj._wantHold = false;
            return;
        }
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, obj.x, obj.y);
        const see = this.worldRange(spec.see);
        if (d > see) obj._wantHold = false;
        if (ai && ai.mode === 'chase') {
            ai.tx = this.player.x;
            ai.ty = this.player.y;
            ai.chaseSpeed = spec.speed || 1;
            const from = Math.hypot(obj.x - (ai.ox || obj.x), obj.y - (ai.oy || obj.y));
            if (from > this.worldRange(spec.leash)) {
                obj._wantHold = true;
                this.resumeNpcPatrol(obj);
                this.showToast(this.npcName(obj) + '追了一段，没跟上，回去了');
                return;
            }
            const catchR = this.worldRange(spec.catch);
            if (d > catchR) this._wantAskNeedLeave = false;
            if (d <= catchR && this.canAskWanted() && !this.scene.isActive(CONFIG.SCENES.DIALOGUE)) {
                this.armWantAskCooldown(true);
                this.openWantedAsk(obj);
            }
            return;
        }
        if (ai && ai.mode === 'search') {
            if (GameState.gameTime() >= (ai.until || 0)) {
                this.finishSearch(obj, true);
                return;
            }
            if (d <= see) {
                this.finishSearch(obj, false);
                this.startWantedChase(obj, spec);
            }
            return;
        }
        if (obj._wantHold) return;
        if (d > see) return;
        if (ai && (ai.mode === 'pickup' || ai.confronted)) return;
        this.startWantedChase(obj, spec);
    }

    npcByItemId(id) {
        if (!id) return null;
        return (this.interactives || []).find(o => o && o.itemData && o.itemData.id === id) || null;
    }

    nearestGuard(from) {
        let best = null;
        let bestD = Infinity;
        (this.interactives || []).forEach(obj => {
            if (!obj || obj === from || !this.isGuardNpc(obj)) return;
            if (GameState.isNpcSick && GameState.isNpcSick(this.npcIdOf(obj))) return;
            const d = Phaser.Math.Distance.Between(from.x, from.y, obj.x, obj.y);
            if (d < bestD) { best = obj; bestD = d; }
        });
        return best;
    }

    pickSearchPoint(obj) {
        const ai = obj && obj._ai;
        if (!ai) return;
        const cx = ai.cx != null ? ai.cx : obj.x;
        const cy = ai.cy != null ? ai.cy : obj.y;
        for (let i = 0; i < 8; i++) {
            const a = Math.random() * Math.PI * 2;
            const rad = this.worldRange(70 + Math.random() * 110);
            const x = cx + Math.cos(a) * rad;
            const y = cy + Math.sin(a) * rad;
            if (!this.npcCanStand(x, y)) continue;
            ai.tx = x;
            ai.ty = y;
            return;
        }
        ai.tx = cx;
        ai.ty = cy;
    }

    finishSearch(obj, missed) {
        if (!obj || !obj._ai || obj._ai.mode !== 'search') return;
        const other = this.npcByItemId(obj._ai.partnerId);
        this.setShout(obj, false);
        this.showNpcAlert(obj, false);
        obj._wantHold = true;
        this.resumeNpcPatrol(obj);
        if (other && other._ai && other._ai.mode === 'search') {
            this.setShout(other, false);
            this.showNpcAlert(other, false);
            other._wantHold = true;
            this.resumeNpcPatrol(other);
        }
        if (missed) this.showToast('没找到人，各自回去了');
    }

    beginSearch(villager, guard, x, y) {
        if (!villager || !guard) return;
        this.setShout(villager, false);
        const until = GameState.gameTime() + 10000;
        const vid = villager.itemData && villager.itemData.id;
        const gid = guard.itemData && guard.itemData.id;
        const arm = (obj, partner) => {
            if (obj._homeX == null) {
                obj._homeX = obj.x;
                obj._homeY = obj.y;
            }
            obj._ai = {
                mode: 'search',
                cx: x, cy: y,
                tx: x, ty: y,
                until: until,
                partnerId: partner || '',
                stuck: 0
            };
            this.pickSearchPoint(obj);
        };
        arm(villager, gid);
        arm(guard, vid);
        this.showNpcAlert(guard, true);
        this.showToast(this.npcName(villager) + '把' + this.npcName(guard) + '带到了这边');
    }

    startVillagerFetch(obj) {
        if (!obj) return;
        const guard = this.nearestGuard(obj);
        if (!guard) {
            obj._wantHold = true;
            this.setShout(obj, false);
            this.resumeNpcPatrol(obj);
            this.showToast(this.npcName(obj) + '喊了半天，附近没有守卫');
            return;
        }
        obj._ai = {
            mode: 'fetch',
            tx: guard.x,
            ty: guard.y,
            guardId: (guard.itemData && guard.itemData.id) || '',
            seenX: obj._seenX != null ? obj._seenX : obj.x,
            seenY: obj._seenY != null ? obj._seenY : obj.y,
            stuck: 0,
            chaseSpeed: 1.55
        };
        this.setShout(obj, true);
        this.showToast(this.npcName(obj) + '朝' + this.npcName(guard) + '跑去');
    }

    villagerWantsPay(npcId) {
        const s = String(npcId || '');
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * (i + 3)) % 997;
        return h % 2 === 0;
    }

    bribePrice() {
        const w = GameState.wanted ? GameState.wanted() : 1;
        const base = w >= 3 ? 150 : (w >= 2 ? 100 : 50);
        const swing = w >= 3 ? 20 : 10;
        let n = base - swing + Math.floor(Math.random() * (swing * 2 + 1));
        n = Math.round(n / 5) * 5;
        return Math.max(5, n);
    }

    openVillagerBribe(obj) {
        if (!obj || !window.DialogueDB || !DialogueDB.makeVillagerBribeDef) return false;
        if (this.scene.isActive(CONFIG.SCENES.DIALOGUE) || this.scene.isActive(CONFIG.SCENES.BATTLE)
            || this.scene.isActive(CONFIG.SCENES.STEAL) || this.scene.isActive(CONFIG.SCENES.BACKPACK)
            || this.scene.isActive(CONFIG.SCENES.SHOP)) return false;
        const price = this.bribePrice();
        obj._bribePrice = price;
        obj._bribeAsked = true;
        const id = this.npcIdOf(obj);
        const npc = DialogueDB.get(id);
        const data = obj.itemData || {};
        const def = DialogueDB.makeVillagerBribeDef(
            (npc && npc.name) || this.npcName(obj),
            (npc && npc.portrait) || '',
            price
        );
        this.scene.pause();
        this.scene.launch(CONFIG.SCENES.DIALOGUE, {
            dialogue: def,
            itemData: data,
            accuse: true,
            caughtItemId: data.id || '',
            bribePrice: price
        });
        return true;
    }

    openVillagerAsk(obj) {
        if (!obj || !this.player || !window.DialogueDB || !DialogueDB.makeVillagerAskDef) return false;
        if (this.scene.isActive(CONFIG.SCENES.DIALOGUE) || this.scene.isActive(CONFIG.SCENES.BATTLE)
            || this.scene.isActive(CONFIG.SCENES.STEAL) || this.scene.isActive(CONFIG.SCENES.BACKPACK)
            || this.scene.isActive(CONFIG.SCENES.SHOP)) return false;
        obj._seenX = this.player.x;
        obj._seenY = this.player.y;
        const data = obj.itemData || {};
        const id = this.npcIdOf(obj);
        const npc = DialogueDB.get(id);
        const bribe = this.villagerWantsPay(id);
        const def = DialogueDB.makeVillagerAskDef(
            (npc && npc.name) || this.npcName(obj),
            id,
            (npc && npc.portrait) || '',
            bribe
        );
        this.scene.pause();
        this.scene.launch(CONFIG.SCENES.DIALOGUE, {
            dialogue: def,
            itemData: data,
            accuse: true,
            caughtItemId: data.id || ''
        });
        return true;
    }

    updateWantedCivilian(obj) {
        if (!obj || !this.isPersonNpc(obj) || this.isGuardNpc(obj) || !this.player) return;
        const w = GameState.wanted ? GameState.wanted() : 0;
        const ai = obj._ai;
        const busy = ai && (ai.mode === 'accuse' || ai.mode === 'fetch' || ai.mode === 'search');
        if (w < 3) {
            if (ai && (ai.mode === 'accuse' || ai.mode === 'fetch')) {
                this.setShout(obj, false);
                this.resumeNpcPatrol(obj);
            } else if (ai && ai.mode === 'search') this.finishSearch(obj, false);
            return;
        }
        const see = this.worldRange(220);
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, obj.x, obj.y);
        if (d > see && !busy) obj._wantHold = false;
        if (ai && ai.mode === 'accuse') {
            ai.tx = this.player.x;
            ai.ty = this.player.y;
            obj._seenX = this.player.x;
            obj._seenY = this.player.y;
            const from = Math.hypot(obj.x - (ai.ox || obj.x), obj.y - (ai.oy || obj.y));
            if (from > this.worldRange(420)) {
                obj._wantHold = true;
                this.resumeNpcPatrol(obj);
                return;
            }
            const catchR = this.worldRange(110);
            if (d > catchR) this._wantAskNeedLeave = false;
            if (d <= catchR && this.canAskWanted() && this.openVillagerAsk(obj)) {
                this.armWantAskCooldown(true);
            }
            return;
        }
        if (ai && ai.mode === 'fetch') {
            this.setShout(obj, true);
            const guard = this.npcByItemId(ai.guardId) || this.nearestGuard(obj);
            if (!guard) {
                obj._wantHold = true;
                this.setShout(obj, false);
                this.resumeNpcPatrol(obj);
                this.showToast(this.npcName(obj) + '没叫到人，回去了');
                return;
            }
            ai.guardId = (guard.itemData && guard.itemData.id) || ai.guardId;
            ai.tx = guard.x;
            ai.ty = guard.y;
            if (Phaser.Math.Distance.Between(obj.x, obj.y, guard.x, guard.y) <= this.worldRange(56)) {
                this.beginSearch(obj, guard, ai.seenX, ai.seenY);
            }
            return;
        }
        if (ai && ai.mode === 'search') {
            if (GameState.gameTime() >= (ai.until || 0)) this.finishSearch(obj, true);
            return;
        }
        if (obj._wantHold) return;
        if (d > see) return;
        if (ai && (ai.mode === 'pickup' || ai.confronted || ai.mode === 'chase' || ai.mode === 'goto' || ai.mode === 'look')) return;
        if (obj._homeX == null) {
            obj._homeX = obj.x;
            obj._homeY = obj.y;
        }
        obj._ai = {
            mode: 'accuse',
            tx: this.player.x,
            ty: this.player.y,
            ox: obj.x,
            oy: obj.y,
            stuck: 0
        };
        this.showToast(this.npcName(obj) + '朝你走过来');
    }

    sendNpcHome(obj) {
        if (!obj) return;
        if (obj._homeX == null) return;
        obj._ai = { mode: 'home', tx: obj._homeX, ty: obj._homeY, stuck: 0, spotted: false, lookUntil: 0 };
        this.showNpcAlert(obj, false);
    }

    onDialogueClosed(p) {
        this.flushPendingGroundLoot();
        p = p || {};
        if (p.report === 'surrender') {
            const level = GameState.surrenderLevelVoluntary
                ? GameState.surrenderLevelVoluntary()
                : Math.max(1, GameState.wanted ? GameState.wanted() : 1);
            const result = GameState.applySurrender
                ? GameState.applySurrender(level)
                : null;
            if (result && result.toast) this.showToast(result.toast);
            else this.showToast('你伏法了。');
            if (this.refreshHud) this.refreshHud();
            this.armWantAskCooldown(true);
            if (p.caught) {
                const id = p.caughtItemId;
                const obj = (this.interactives || []).find(o => o && o.itemData && o.itemData.id === id)
                    || (this.interactives || []).find(o => o && o._ai && o._ai.confronted);
                if (obj) this.sendNpcHome(obj);
            }
            return;
        }
        if (p.accuse) {
            const obj = (this.interactives || []).find(o => o && o.itemData && o.itemData.id === p.caughtItemId);
            if (!obj) return;
            if (p.report === 'pass' || p.report === 'pay') {
                if (p.report === 'pay') {
                    const price = p.bribePrice || obj._bribePrice || 0;
                    const gold = GameState.get('金币', 0);
                    if (!(price > 0) || gold < price) {
                        this.showToast(window.t('game.notEnoughGold', '格罗申不够。{npc}去叫人了', { npc: this.npcName(obj) }));
                        obj._bribeAsked = false;
                        this.startVillagerFetch(obj);
                        return;
                    }
                    GameState.add('金币', -price);
                    this.showToast(window.t('game.gaveBribe', '给了 {n} 格罗申，他当没看见', { n: price }));
                }
                obj._bribeAsked = false;
                obj._wantHold = true;
                this.setShout(obj, false);
                this.resumeNpcPatrol(obj);
            } else if (!obj._bribeAsked && this.villagerWantsPay(this.npcIdOf(obj)) && this.openVillagerBribe(obj)) {
                return;
            } else {
                obj._bribeAsked = false;
                this.startVillagerFetch(obj);
            }
            return;
        }
        if (!p.caught) return;
        this.armWantAskCooldown(true);
        const id = p.caughtItemId;
        const obj = (this.interactives || []).find(o => o && o.itemData && o.itemData.id === id)
            || (this.interactives || []).find(o => o && o._ai && o._ai.confronted);
        if (obj) this.sendNpcHome(obj);
    }

    openShop(itemData) {
        if (!GameState.get('hasBackpack', false)) {
            this.showToast('还没有背包，先去拾取一个背包');
            return;
        }
        const nid = this.npcIdOfData(itemData);
        if (nid && GameState.isNpcSick && GameState.isNpcSick(nid)) {
            this.showToast((itemData && itemData.name || '摊主') + '病得起不来床');
            return;
        }
        if (!window.ShopDB || !ShopDB.shopFor(itemData)) {
            this.showToast('这张摊还没有货单');
            return;
        }
        const shopDef = ShopDB.shopFor(itemData);
        if (ShopDB.isOpen && !ShopDB.isOpen(shopDef)) {
            this.showToast(ShopDB.closedText(shopDef));
            return;
        }
        if (this.scene.isActive(CONFIG.SCENES.SHOP) || this.scene.isActive(CONFIG.SCENES.BACKPACK)) return;
        const ready = ShopDB.ensure(this.currentMapKey, itemData);
        this.scene.pause();
        this.scene.launch(CONFIG.SCENES.SHOP, {
            shopId: ready.id,
            shopDef: ready.def,
            mapKey: this.currentMapKey
        });
        this.showToast('和' + ((ready.def && ready.def.name) || '摊主') + '交易');
    }

    maybeRefreshShops() {
        if (!window.ShopDB || !this.interactives) return;
        this._shopAcc = (this._shopAcc || 0) + this.game.loop.delta;
        if (this._shopAcc < 800) return;
        this._shopAcc = 0;
        this.interactives.forEach(obj => {
            const d = obj.itemData;
            if (!d || d.action !== 'shop') return;
            ShopDB.ensure(this.currentMapKey, d);
        });
    }

    chestId(itemData) {
        return LootDB.containerId(this.currentMapKey, itemData);
    }

    chestRefreshSec(itemData, state) {
        if ((itemData && itemData.noRefresh) || (state && state.noRefresh)) return 0;
        const n = parseInt(itemData && itemData.refreshSec, 10);
        if (isFinite(n) && n > 0) return n;
        return CONFIG.CHEST_REFRESH_SECONDS || 300;
    }

    setChestOpenVisual(obj, open) {
        const data = obj && obj.itemData;
        if (!data) return;
        if (open) {
            data.action = 'open';
            obj.setTint(0xaaaaaa);
            obj.promptText = '按 E 打开';
            if (obj.prompt) obj.prompt.setText('按 E 打开');
        } else {
            data.action = 'steal';
            if (obj.clearTint) obj.clearTint();
            else obj.setTint(0xffffff);
            obj.promptText = '按 E 偷窃';
            if (obj.prompt) obj.prompt.setText('按 E 偷窃');
        }
        if (obj.setInteractable) obj.setInteractable(true);
    }

    tryRefreshOne(obj) {
        const data = obj && obj.itemData;
        if (!data || !LootDB.isChest(data) || data.noRefresh) return false;
        const cid = this.chestId(data);
        const st = GameState.getChestState(cid);
        if (!st || !st.unlocked || st.noRefresh) return false;
        const sec = this.chestRefreshSec(data, st);
        if (sec <= 0) return false;
        if (GameState.gameTime() - (st.unlockedAt || 0) < sec * 1000) return false;
        const keep = GameState.getContainerItems(cid).filter(it => LootDB.keepOnRefresh(it));
        GameState.setContainerItems(cid, data.name || '容器', keep);
        GameState.setChestState(cid, { unlocked: false, needsReroll: true });
        return true;
    }

    maybeRefreshChests() {
        this._refreshAcc = (this._refreshAcc || 0) + this.game.loop.delta;
        if (this._refreshAcc < 400) return;
        this._refreshAcc = 0;
        (this.interactives || []).forEach(obj => {
            if (!obj.itemData || !LootDB.isChest(obj.itemData)) return;
            if (this.tryRefreshOne(obj)) this.setChestOpenVisual(obj, false);
        });
    }

    applyAllChests() {
        (this.interactives || []).forEach(obj => {
            if (!obj.itemData || !LootDB.isChest(obj.itemData)) return;
            this.tryRefreshOne(obj);
            const st = GameState.getChestState(this.chestId(obj.itemData));
            this.setChestOpenVisual(obj, !!(st && st.unlocked));
        });
    }

    applyQuestLoot(itemData) {
        if (!itemData || !window.LootDB || !LootDB.injectQuestLoot) return;
        const cid = this.chestId(itemData);
        GameState.ensureContainer(cid, itemData.name || '容器');
        const items = GameState.getContainerItems(cid);
        const got = LootDB.injectQuestLoot(itemData, items, GameState.uniqueCtx());
        if (got && got.changed) GameState.setContainerItems(cid, itemData.name || '容器', items);
        if (got && got.skipped && got.skipped.length) {
            this.showToast(got.skipped[0]);
        }
    }

    fillChestLoot(itemData) {
        const cid = this.chestId(itemData);
        const st = GameState.getChestState(cid) || {};
        if (st.generated && !st.needsReroll) {
            this.applyQuestLoot(itemData);
            return { gold: 0, lockpicks: 0, items: GameState.getContainerItems(cid) };
        }
        const existing = GameState.getContainerItems(cid);
        const keep = existing.filter(it => LootDB.keepOnRefresh(it));
        const result = LootDB.generate(itemData, keep, GameState.uniqueCtx());
        GameState.setContainerItems(cid, itemData.name || '容器', result.items);
        if (result.gold) GameState.add('金币', result.gold);
        GameState.setChestState(cid, { generated: true, needsReroll: false });
        return result;
    }

    onBattleResult(r) {
        r = r || {};
        if (this.refreshHud) this.refreshHud();
        const ground = GameState.takePendingGroundLoot ? GameState.takePendingGroundLoot() : [];
        if (r.won) {
            ground.forEach((it, i) => this.dropItemOnGround(it, i, ground.length));
            if (this.player && GameState.saveCheckpoint) {
                GameState.saveCheckpoint(this.currentMapKey, this.player.x, this.player.y);
            }
            if (ground.length) this.showToast(ground.length + '件战利品掉在脚边，放进格子才能带走');
            else if (r.lootLine) this.showToast(r.lootLine);
        }
        const talking = this.scene.isActive(CONFIG.SCENES.DIALOGUE);
        if (!talking && this.scene.isPaused()) this.scene.resume();
        if (!r.won && !r.fled) {
            this.applyBattleSurrender(r);
            this.armWantAskCooldown(true);
            this.releaseConfrontedNpcs();
        } else if (r.fled || r.won) {
            this.armWantAskCooldown(true);
        }
    }

    /** 盘问冷却：必须先离开贴身范围，且过一段时间，才允许再盘问 */
    armWantAskCooldown(needLeave) {
        const now = (window.GameState && GameState.gameTime) ? GameState.gameTime() : Date.now();
        this._wantAskCdUntil = now + 14000;
        if (needLeave) this._wantAskNeedLeave = true;
    }

    canAskWanted() {
        if (this._guideOpen) return false;
        if (this.scene.isActive(CONFIG.SCENES.DIALOGUE) || this.scene.isActive(CONFIG.SCENES.BATTLE)
            || this.scene.isActive(CONFIG.SCENES.STEAL) || this.scene.isActive(CONFIG.SCENES.BACKPACK)
            || this.scene.isActive(CONFIG.SCENES.SHOP)) return false;
        if (this._wantAskNeedLeave) return false;
        const now = (window.GameState && GameState.gameTime) ? GameState.gameTime() : Date.now();
        return now >= (this._wantAskCdUntil || 0);
    }

    releaseConfrontedNpcs() {
        (this.interactives || []).forEach(obj => {
            if (!obj || !obj._ai) return;
            if (obj._ai.confronted || obj._ai.mode === 'chase' || obj._ai.mode === 'accuse') {
                this.sendNpcHome(obj);
            }
        });
    }

    /** 战败 / 战斗中主动伏法：罚款 + DEBUFF；非守卫按 1 级 */
    applyBattleSurrender(r) {
        r = r || {};
        const authority = this.isAuthorityFight(r);
        const level = GameState.surrenderLevelForDefeat
            ? GameState.surrenderLevelForDefeat(authority)
            : (authority ? Math.max(1, GameState.wanted ? GameState.wanted() : 1) : 1);
        const result = GameState.applySurrender
            ? GameState.applySurrender(level)
            : null;
        if (this.refreshHud) this.refreshHud();
        if (result && result.toast) this.showToast(result.toast);
        else this.showToast('你被拿下了，罚了款。');
    }

    isAuthorityFight(r) {
        r = r || {};
        if (r.caught) return true;
        const ids = r.enemyIds || [];
        if (ids.length && window.DialogueDB && DialogueDB.isGuard) {
            return ids.some(id => DialogueDB.isGuard(id));
        }
        const kinds = r.enemyKinds || [];
        if (!kinds.length) return false;
        return kinds.some(k => k === 'guard' || k === 'elite' || k === 'captain');
    }

    rollbackDeath() {
        if (this.scene.isActive(CONFIG.SCENES.BATTLE)) this.scene.stop(CONFIG.SCENES.BATTLE);
        if (this.scene.isActive(CONFIG.SCENES.DIALOGUE)) this.scene.stop(CONFIG.SCENES.DIALOGUE);
        if (this.scene.isActive(CONFIG.SCENES.BACKPACK)) this.scene.stop(CONFIG.SCENES.BACKPACK);
        if (!GameState.hasCheckpoint || !GameState.hasCheckpoint()) {
            this.showToast('你倒下了。');
            if (this.scene.isPaused()) this.scene.resume();
            return;
        }
        const pos = GameState.restoreCheckpoint();
        this.scene.start(CONFIG.SCENES.GAME, {
            mapKey: pos && pos.mapKey,
            spawnX: pos && pos.x,
            spawnY: pos && pos.y,
            rollback: true
        });
    }

    isPersonNpc(obj) {
        const a = obj && obj.itemData && obj.itemData.action;
        return a === 'dialogue' || a === 'shop';
    }

    npcIdOf(obj) {
        return this.npcIdOfData(obj && obj.itemData);
    }

    npcIdOfData(data) {
        if (!data) return '';
        return data.npcId || data.dialogueId || data.shopId || data.id || '';
    }

    npcName(obj) {
        const data = obj && obj.itemData;
        if (!data) return '有人';
        const id = data.npcId || data.dialogueId;
        if (id && window.DialogueDB && DialogueDB.get) {
            const npc = DialogueDB.get(id);
            if (npc && npc.name) return npc.name;
        }
        return data.name || '有人';
    }

    showNpcAlert(obj, on) {
        if (!obj) return;
        if (on) {
            if (!obj._alertMark || !obj._alertMark.active) {
                obj._alertMark = this.add.text(obj.x, obj.y - obj.displayHeight / 2 - 28, '！', {
                    fontSize: '28px', fill: '#ffe66d', fontStyle: 'bold',
                    stroke: '#000000', strokeThickness: 5
                }).setOrigin(0.5).setDepth(50001);
            }
            obj._alertMark.setVisible(true);
            obj._alertMark.setPosition(obj.x, obj.y - obj.displayHeight / 2 - 28);
        } else if (obj._alertMark) {
            obj._alertMark.destroy();
            obj._alertMark = null;
        }
    }

    setShout(obj, on) {
        if (!obj) return;
        if (!on) {
            if (obj._shout) {
                obj._shout.destroy();
                obj._shout = null;
            }
            return;
        }
        const y = obj.y - (obj.displayHeight || 40) / 2 - 54;
        if (!obj._shout || !obj._shout.active) {
            obj._shout = this.add.text(obj.x, y, '来人啊！守卫！', {
                fontSize: '20px', fill: '#ffd6a5', fontStyle: 'bold',
                stroke: '#000000', strokeThickness: 4
            }).setOrigin(0.5).setDepth(50002);
        }
        obj._shout.setVisible(true);
        obj._shout.setPosition(obj.x, y);
    }

    placeNpc(obj, x, y) {
        obj.x = x;
        obj.y = y;
        const w = obj.displayWidth;
        const h = obj.displayHeight;
        obj._occLeft = x - w / 2;
        obj._occTop = y - h / 2;
        obj._occW = w;
        obj._occH = h;
        const it = obj.itemData || {};
        obj._sortY = WorldManager.sortYOfRect(obj._occLeft, obj._occTop, w, h, WorldManager.sortAnchorOf('item', it));
        obj.setDepth(WorldManager.ySortDepth(obj._sortY) + WorldManager.layerZ(obj._z));
        if (obj._alertMark) obj._alertMark.setPosition(x, y - h / 2 - 28);
        if (obj._shout && obj._shout.active) obj._shout.setPosition(x, y - h / 2 - 54);
    }

    npcCanStand(x, y) {
        const hw = 12, hh = 14;
        if (this.walkableRects && this.walkableRects.length && !WorldManager.pointWalkable(x, y, this.walkableRects)) return false;
        if (WorldManager.pointHitsAnyWall && WorldManager.pointHitsAnyWall(x, y, this.shapedWalls, hw, hh)) return false;
        return true;
    }

    npcStandNear(obj, tx, ty) {
        const hx = obj._homeX != null ? obj._homeX : obj.x;
        const hy = obj._homeY != null ? obj._homeY : obj.y;
        let dx = hx - tx, dy = hy - ty;
        const d = Math.hypot(dx, dy) || 1;
        const gap = 52 * this.npcSpeedMul();
        const x = tx + dx / d * gap;
        const y = ty + dy / d * gap;
        if (WorldManager.snapSpawnFree) {
            return WorldManager.snapSpawnFree(x, y, this.walkableRects, this.shapedWalls, hx, hy, 12, 14);
        }
        return { x: x, y: y };
    }

    startNpcInvestigate(obj, tx, ty) {
        if (obj._homeX == null) {
            obj._homeX = obj.x;
            obj._homeY = obj.y;
        }
        const stand = this.npcStandNear(obj, tx, ty);
        obj._ai = { mode: 'goto', tx: stand.x, ty: stand.y, stuck: 0, spotted: false, lookUntil: 0, noiseX: tx, noiseY: ty, confronted: false };
        this.showNpcAlert(obj, true);
    }

    emitLockNoise(box, opts) {
        const src = box || this.player;
        if (!src) return;
        const data = box && box.itemData;
        let radius = GameState.noiseRadius ? GameState.noiseRadius(data && data.lockLevel) : 320;
        radius = this.worldRange(radius);
        const huge = !!(opts && opts.huge);
        if (huge) radius *= (CONFIG.STEAL && CONFIG.STEAL.FAKE_NOISE_MUL) || 2.5;
        const hearers = [];
        (this.interactives || []).forEach(obj => {
            if (!this.isPersonNpc(obj)) return;
            if (GameState.isNpcSick && GameState.isNpcSick(this.npcIdOf(obj))) return;
            const mv = this.npcMoveOf(obj);
            if (mv && mv.hearLock === false) return;
            const d = Phaser.Math.Distance.Between(src.x, src.y, obj.x, obj.y);
            if (d <= radius) hearers.push(obj);
        });
        if (!hearers.length) {
            this.showToast(huge ? '假钥匙拧断了，动静很大，幸好周围没人' : '锁响了一声，周围好像没人听见');
            return;
        }
        hearers.forEach(obj => this.startNpcInvestigate(obj, src.x, src.y));
        if (huge) this.showToast('假钥匙拧断了，动静很大，有人过来了');
        else if (hearers.length === 1) this.showToast('锁响了一声，' + this.npcName(hearers[0]) + '朝这边看过来');
        else this.showToast('锁响了一声，附近有人过来查看');
    }

    npcBeginLook(obj, ai) {
        const st = CONFIG.STEAL || {};
        const spotR = this.worldRange((GameState.spotRange && GameState.spotRange()) || st.SPOT_RANGE || 110);
        const near = this.player && Phaser.Math.Distance.Between(this.player.x, this.player.y, obj.x, obj.y) <= spotR;
        if (near && !ai.spotted) {
            ai.spotted = true;
            this.showToast(this.npcName(obj) + '走过来看了一眼');
            this.tryCaughtTalk(obj);
        }
        ai.mode = 'look';
        ai.lookUntil = GameState.gameTime() + (ai.spotted ? (st.SPOT_MS || 4500) : (st.LOOK_MS || 2800));
    }

    npcPlayAnim(obj, dx, dy, moving) {
        if (!obj || !obj._npcId || typeof obj.playNpcDir !== 'function') return;
        let sector = obj._npcFacing != null ? obj._npcFacing : 2;
        if (dx || dy) sector = InteractiveObject.sectorFrom(dx, dy);
        obj.playNpcDir(sector, !!moving);
    }

    npcMoveOf(obj) {
        const id = this.npcIdOf(obj);
        if (window.DialogueDB && typeof DialogueDB.moveOf === 'function') return DialogueDB.moveOf(id);
        return { mode: 'stand', hearLock: true, pickFood: true };
    }

    npcSpeedMul() {
        const base = CONFIG.PLAYER_SCALE || 0.5;
        const s = (this.player && this.player.playerScale > 0)
            ? this.player.playerScale
            : base;
        return s / base;
    }

    npcWalkMul(obj) {
        let m = 1.5 * 0.75;
        if (this.npcPathOf(obj)) m *= 1.5;
        return m;
    }

    worldRange(px) {
        return (px || 0) * this.npcSpeedMul();
    }

    npcPathOf(obj) {
        const pts = obj && obj.itemData && obj.itemData.walkPath;
        if (!pts || pts.length < 2) return null;
        return pts;
    }

    ensureNpcRoutine(obj) {
        if (!obj || obj._ai) return;
        if (obj._homeX == null) {
            obj._homeX = obj.x;
            obj._homeY = obj.y;
        }
        if (GameState.isNpcSick && GameState.isNpcSick(this.npcIdOf(obj))) return;
        const path = this.npcPathOf(obj);
        if (path) {
            this.npcPickPathTarget(obj, path);
            return;
        }
        const mv = this.npcMoveOf(obj);
        if (!mv || mv.mode === 'stand' || mv.mode === 'path') return;
        this.npcPickRoutineTarget(obj, mv);
    }

    npcPickPathTarget(obj, path) {
        if (!path || !path.length) return;
        if (obj._pathI == null || obj._pathI < 0) {
            let best = 0, bestD = Infinity;
            path.forEach((p, i) => {
                const d = Math.hypot(obj.x - p.x, obj.y - p.y);
                if (d < bestD) { bestD = d; best = i; }
            });
            obj._pathI = best;
        } else {
            obj._pathI = (obj._pathI + 1) % path.length;
        }
        const p = path[obj._pathI];
        obj._ai = { mode: 'routine', kind: 'path', tx: p.x, ty: p.y, stuck: 0 };
    }

    npcPickRoutineTarget(obj, mv) {
        const hx = obj._homeX != null ? obj._homeX : obj.x;
        const hy = obj._homeY != null ? obj._homeY : obj.y;
        const snap = (x, y) => {
            if (WorldManager.snapSpawnFree) {
                return WorldManager.snapSpawnFree(x, y, this.walkableRects, this.shapedWalls, hx, hy, 12, 14);
            }
            return { x: x, y: y };
        };
        if (mv.mode === 'pace') {
            const dist = mv.dist || 160;
            obj._paceSign = obj._paceSign === 1 ? -1 : 1;
            let tx = hx, ty = hy;
            if (mv.axis === 'y') ty = hy + dist * obj._paceSign;
            else tx = hx + dist * obj._paceSign;
            const p = snap(tx, ty);
            obj._ai = { mode: 'routine', tx: p.x, ty: p.y, stuck: 0 };
            return;
        }
        const r = mv.radius || 160;
        const stepMax = (mv.step > 0) ? mv.step : 0;
        for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2;
            let tx, ty;
            if (stepMax > 0) {
                const d = 28 + Math.random() * stepMax;
                tx = obj.x + Math.cos(a) * d;
                ty = obj.y + Math.sin(a) * d;
                if (Math.hypot(tx - hx, ty - hy) > r) {
                    const ang = Math.atan2(hy - obj.y, hx - obj.x) || a;
                    tx = obj.x + Math.cos(ang) * Math.min(d, 40 + Math.random() * stepMax);
                    ty = obj.y + Math.sin(ang) * Math.min(d, 40 + Math.random() * stepMax);
                }
            } else {
                const d = 36 + Math.random() * r;
                tx = hx + Math.cos(a) * d;
                ty = hy + Math.sin(a) * d;
            }
            if (!this.npcCanStand(tx, ty)) continue;
            const p = snap(tx, ty);
            if (Math.hypot(p.x - hx, p.y - hy) > r + 8) continue;
            if (Math.hypot(p.x - hx, p.y - hy) < 20 && i < 8 && !stepMax) continue;
            if (Math.hypot(p.x - obj.x, p.y - obj.y) < 18) continue;
            obj._ai = { mode: 'routine', tx: p.x, ty: p.y, stuck: 0, pauseMs: mv.pauseMs || 0, pauseJitter: mv.pauseJitter || 0 };
            return;
        }
        const waitFail = (mv.pauseMs > 0)
            ? (mv.pauseMs + Math.random() * (mv.pauseJitter || 0))
            : 1200;
        obj._ai = { mode: 'routine_wait', waitUntil: GameState.gameTime() + waitFail };
    }

    npcRoutinePauseMs(ai) {
        if (ai && ai.kind === 'path') return 280;
        if (ai && ai.pauseMs > 0) return ai.pauseMs + Math.random() * (ai.pauseJitter || 0);
        return 700 + Math.random() * 2200;
    }

    updateNpcAi(dt) {
        if (!this.interactives || this.isStealing) return;
        const st = CONFIG.STEAL || {};
        this.interactives.forEach(obj => {
            if (this.isPersonNpc(obj)) {
                if (GameState.isNpcSick && GameState.isNpcSick(this.npcIdOf(obj))) {
                    if (obj._ai && (obj._ai.mode === 'routine' || obj._ai.mode === 'routine_wait')) obj._ai = null;
                    this.npcPlayAnim(obj, 0, 1, false);
                    return;
                }
                this.ensureNpcRoutine(obj);
                this.updateWantedGuard(obj);
                this.updateWantedCivilian(obj);
            }
            const ai = obj._ai;
            if (!ai) return;
            if (ai.mode === 'routine_wait') {
                this.npcPlayAnim(obj, 0, 0, false);
                if (GameState.gameTime() >= (ai.waitUntil || 0)) {
                    obj._ai = null;
                    this.ensureNpcRoutine(obj);
                }
                return;
            }
            if (ai.mode === 'pickup') {
                const still = this.interactives.some(o => o && o.itemData && o.itemData.id === ai.dropId);
                if (!still) {
                    this.sendNpcHome(obj);
                    return;
                }
            }
            if (ai.mode === 'look') {
                const stLook = CONFIG.STEAL || {};
                const spotR = this.worldRange((GameState.spotRange && GameState.spotRange()) || stLook.SPOT_RANGE || 110);
                if (!ai.spotted && this.player && Phaser.Math.Distance.Between(this.player.x, this.player.y, obj.x, obj.y) <= spotR) {
                    ai.spotted = true;
                    ai.lookUntil = GameState.gameTime() + (stLook.SPOT_MS || 4500);
                    this.showToast(this.npcName(obj) + '走过来看了一眼');
                    this.tryCaughtTalk(obj);
                }
                if (this.player) this.npcPlayAnim(obj, this.player.x - obj.x, this.player.y - obj.y, false);
                else this.npcPlayAnim(obj, 0, 1, false);
                if (GameState.gameTime() >= ai.lookUntil) {
                    ai.mode = 'home';
                    ai.tx = obj._homeX;
                    ai.ty = obj._homeY;
                    ai.stuck = 0;
                }
                return;
            }
            const tx = ai.tx, ty = ai.ty;
            const dx = tx - obj.x, dy = ty - obj.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= 10) {
                this.npcPlayAnim(obj, dx, dy, false);
                if (ai.mode === 'chase' || ai.mode === 'accuse' || ai.mode === 'fetch') {
                    return;
                } else if (ai.mode === 'search') {
                    if (GameState.gameTime() >= (ai.until || 0)) this.finishSearch(obj, true);
                    else this.pickSearchPoint(obj);
                    return;
                } else if (ai.mode === 'routine') {
                    ai.mode = 'routine_wait';
                    ai.waitUntil = GameState.gameTime() + this.npcRoutinePauseMs(ai);
                } else if (ai.mode === 'home') {
                    this.placeNpc(obj, obj._homeX, obj._homeY);
                    this.showNpcAlert(obj, false);
                    obj._ai = null;
                } else if (ai.mode === 'pickup') {
                    this.npcFinishPickup(obj, ai);
                } else {
                    this.npcBeginLook(obj, ai);
                }
                return;
            }
            let base = ai.mode === 'routine' ? 52 : (st.INVESTIGATE_SPEED || 90);
            if (ai.mode === 'chase') base = (st.INVESTIGATE_SPEED || 90) * (ai.chaseSpeed || 1);
            else if (ai.mode === 'fetch') base = (st.INVESTIGATE_SPEED || 90) * (ai.chaseSpeed || 1.55);
            else if (ai.mode === 'accuse') base = (st.INVESTIGATE_SPEED || 90);
            const speed = base * this.npcSpeedMul() * this.npcWalkMul(obj);
            const step = speed * (dt || 16) / 1000;
            let nx = obj.x + dx / dist * Math.min(step, dist);
            let ny = obj.y + dy / dist * Math.min(step, dist);
            const farEnough = (x, y) => Math.hypot(x - obj.x, y - obj.y) > 0.2;
            if (!this.npcCanStand(nx, ny)) {
                if (farEnough(nx, obj.y) && this.npcCanStand(nx, obj.y)) ny = obj.y;
                else if (farEnough(obj.x, ny) && this.npcCanStand(obj.x, ny)) nx = obj.x;
                else {
                    this.npcFailStep(obj, ai, dt, dx, dy);
                    return;
                }
            }
            if (!farEnough(nx, ny)) {
                this.npcFailStep(obj, ai, dt, dx, dy);
                return;
            }
            ai.stuck = 0;
            this.npcPlayAnim(obj, nx - obj.x, ny - obj.y, true);
            this.placeNpc(obj, nx, ny);
        });
    }

    npcFailStep(obj, ai, dt, dx, dy) {
        ai.stuck = (ai.stuck || 0) + (dt || 16);
        this.npcPlayAnim(obj, dx, dy, false);
        if (ai.stuck <= 400) return;
        if (ai.mode === 'routine') {
            obj._ai = null;
        } else if (ai.mode === 'chase' || ai.mode === 'accuse') {
            obj._wantHold = true;
            this.resumeNpcPatrol(obj);
        } else if (ai.mode === 'fetch') {
            obj._wantHold = true;
            this.setShout(obj, false);
            this.resumeNpcPatrol(obj);
            this.showToast(this.npcName(obj) + '没叫到人，回去了');
        } else if (ai.mode === 'search') {
            this.pickSearchPoint(obj);
            ai.stuck = 0;
        } else if (ai.mode === 'home') {
            this.placeNpc(obj, obj._homeX, obj._homeY);
            this.showNpcAlert(obj, false);
            obj._ai = null;
        } else if (ai.mode === 'pickup') {
            this.sendNpcHome(obj);
        } else this.npcBeginLook(obj, ai);
    }

    /**
     * 偷窃小游戏结束后的处理
     */
    onStealResult(result) {
        this.isStealing = false;
        if (result.success) {
            // 开锁成功音效（Key）
            if (window.AudioSys) AudioSys.sfx(this, 'sfx_key');
            const box = result.target;
            const data = box.itemData;
            if (data && window.LootDB) {
                const cid = this.chestId(data);
                GameState.setChestState(cid, {
                    unlocked: true,
                    unlockedAt: GameState.gameTime(),
                    noRefresh: !!data.noRefresh
                });
                if (window.QuestDB) QuestDB.markChest(data, cid);
                const loot = this.fillChestLoot(data);
                this.setChestOpenVisual(box, true);
                let msg = '开锁成功！';
                if (loot.gold) msg += window.t('game.lootGold', ' 格罗申 +{n}', { n: loot.gold });
                this.showToast(msg);
            } else {
                this.setChestOpenVisual(box, true);
                this.showToast('开锁成功！');
            }
            // 等偷窃界面关掉、主游戏恢复后再打开容器（避免两个覆盖场景打架）
            if (GameState.get('hasBackpack', false) && box.itemData) {
                this._pendingContainer = { obj: box, data: box.itemData };
            }
            if (window.TutSys) TutSys.notify('chestOpened');
        } else {
            this.emitLockNoise(result.target, { huge: !!result.hugeNoise });
        }
        EventBus.once('steal:result', (r) => this.onStealResult(r));
    }

    /**
     * 背包关闭：处理还在格子外的物品
     */
    onBackpackClosed(payload) {
        if (this.refreshHud) this.refreshHud();
        const leftover = (payload && payload.leftover) || [];
        if (leftover.length === 0) {
            this.containerContext = null;
            return;
        }
        if (window.AudioSys) AudioSys.sfx(this, 'sfx_drop');
        if (payload.fromContainer && this.containerContext) {
            GameState.stashToContainer(this.containerContext.id, this.containerContext.name, leftover);
            this.showToast(leftover.length + '件物品放进了' + (this.containerContext.name || '容器'));
        } else {
            leftover.forEach((it, i) => this.dropItemOnGround(it, i, leftover.length));
            this.showToast(leftover.length + '件物品掉在了地上');
        }
        this.containerContext = null;
    }

    /**
     * 把一件背包物品掉在玩家脚边（可再按E捡回去）
     */
    dropItemOnGround(it, index, total) {
        if (!this.player) return;
        const ang = (index / Math.max(total, 1)) * Math.PI * 2;
        const px = this.player.x + Math.cos(ang) * 48;
        const py = this.player.y + 36 + Math.sin(ang) * 20;
        const drop = {
            id: it.id || ('drop_' + Date.now() + '_' + index),
            defId: it.defId || '',
            image: it.image,
            name: it.name,
            x: px - 28,
            y: py - 28,
            w: 56,
            h: 56,
            interactable: true,
            action: 'pickup',
            rarity: it.rarity || 'common',
            wCells: it.w,
            hCells: it.h,
            rot: it.rot || 0,
            poisoned: !!it.poisoned,
            droppedAt: GameState.gameTime()
        };
        GameState.addGroundDrop(this.currentMapKey, drop);
        this.spawnOneGroundItem(drop);
    }

    /** 进图时把这张地图上已有的掉落物生成出来 */
    spawnGroundDrops() {
        GameState.getGroundDrops(this.currentMapKey).forEach(d => this.spawnOneGroundItem(d));
    }

    spawnOneGroundItem(drop) {
        let key = drop.image ? ('item:' + drop.image) : '';
        if (!key || !this.textures.exists(key)) key = 'item:missing';
        if (!this.textures.exists(key)) return;
        const obj = new InteractiveObject(this, drop.x + drop.w / 2, drop.y + drop.h / 2, key, {
            promptText: '按 E 拾取',
            onInteract: (o) => this.onItemInteract(o, drop)
        });
        obj.setDisplaySize(drop.w, drop.h);
        const dropSortY = WorldManager.sortYOfRect(drop.x, drop.y, drop.w, drop.h, 1);
        obj.setDepth(WorldManager.ySortDepth(dropSortY));
        obj._sortY = dropSortY;
        obj._z = 0;
        obj.itemData = drop;
        if (drop.poisoned && obj.setTint) obj.setTint(0x4ad84a);
        this.interactives.push(obj);
        if (this.occluders) this.occluders.push(obj);
    }

    refreshDayHud() {
        const night = !!(GameState.isNight && GameState.isNight());
        const torch = !!(GameState.hasTorch && GameState.hasTorch());
        const sec = Math.floor((GameState.gameTime && GameState.gameTime()) || 0);
        if (this._hudNight === night && this._hudTorch === torch && this._hudSec === sec) return;
        const first = this._hudNight == null;
        const wasNight = this._hudNight;
        this._hudNight = night;
        this._hudTorch = torch;
        this._hudSec = sec;
        if (this.refreshHud) this.refreshHud();
        if (first) return;
        if (night && wasNight === false) this.showToast(torch ? '天黑了，火把还亮着' : '天黑了');
        else if (!night && wasNight === true) this.showToast('天亮了');
    }

    layoutNightDim(zoom) {
        if (!this.nightDim) return;
        const cam = this.cameras.main;
        const z = zoom || (cam && cam.zoom) || 1;
        if (!(z > 0)) return;
        this.nightDim.setOrigin(0);
        this.nightDim.setScrollFactor(0);
        this.nightDim.setSize(cam.width, cam.height);
        this.nightDim.setScale(1 / z);
        const midX = cam.width * 0.5;
        const midY = cam.height * 0.5;
        this.nightDim.setPosition(
            midX + (0 - midX) / z,
            midY + (0 - midY) / z
        );
        this.nightDim.setDepth(49980);
    }

    ensureNightOverlay() {
        const key = 'nightVignette2';
        if (!this.textures.exists(key)) {
            const s = 1024;
            const tex = this.textures.createCanvas(key, s, s);
            const ctx = tex && tex.getContext ? tex.getContext() : null;
            if (ctx) {
                const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.04, s / 2, s / 2, s * 0.5);
                g.addColorStop(0, 'rgba(0,0,0,0)');
                g.addColorStop(0.16, 'rgba(0,0,0,0.12)');
                g.addColorStop(0.38, 'rgba(0,0,0,0.62)');
                g.addColorStop(0.62, 'rgba(0,0,0,0.9)');
                g.addColorStop(1, 'rgba(0,0,0,1)');
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, s, s);
                tex.refresh();
            }
        }
        if (this.nightSpr) this.nightSpr.destroy();
        if (this.nightDim) this.nightDim.destroy();
        this.nightDim = this.add.rectangle(0, 0, 64, 64, 0x000018, 1)
            .setOrigin(0)
            .setScrollFactor(0)
            .setDepth(49980)
            .setVisible(false);
        const x = this.player ? this.player.x : 0;
        const y = this.player ? this.player.y : 0;
        this.nightSpr = this.add.image(x, y, key).setDepth(49990).setVisible(false);
        this.updateNightOverlay();
    }

    updateNightOverlay() {
        const strength = (GameState.nightStrength && GameState.nightStrength()) || 0;
        const torch = !!(GameState.hasTorch && GameState.hasTorch());
        const on = strength > 0.02;
        if (this.nightDim) {
            this.layoutNightDim();
            this.nightDim.setVisible(on);
            this.nightDim.setAlpha(on ? strength * (torch ? 0.38 : 0.72) : 0);
        }
        if (!this.nightSpr) return;
        this.nightSpr.setVisible(on);
        if (!on || !this.player) return;
        this.nightSpr.setPosition(this.player.x, this.player.y);
        const cam = this.cameras.main;
        const zoom = (cam && cam.zoom) || 1;
        const vw = (cam.width || 1280) / zoom;
        const vh = (cam.height || 720) / zoom;
        const cover = Math.sqrt(vw * vw + vh * vh);
        const mul = torch ? 2.55 : 1.18;
        this.nightSpr.setDisplaySize(cover * mul, cover * mul);
        this.nightSpr.setAlpha(strength);
        this.nightSpr.setDepth(49990);
    }

    restoreSpriteTint(s) {
        if (!s) return;
        if (this.isPersonNpc(s) && GameState.isNpcSick && GameState.isNpcSick(this.npcIdOf(s))) {
            this.tintSickNpc(s, true);
            return;
        }
        const d = s.itemData;
        if (d && d.poisoned && s.setTint) {
            s.setTint(0x4ad84a);
        }
    }

    applySickLooks() {
        (this.interactives || []).forEach(obj => {
            if (this.isPersonNpc(obj) && GameState.isNpcSick && GameState.isNpcSick(this.npcIdOf(obj))) {
                this.tintSickNpc(obj, true);
            }
        });
    }

    tintSickNpc(obj, on) {
        if (!obj) return;
        if (on) {
            if (obj.setTint) obj.setTint(0x7dcc7d);
        } else if (obj.clearTint) obj.clearTint();
        else if (obj.setTint) obj.setTint(0xffffff);
    }

    isNpcBusy(obj) {
        const ai = obj && obj._ai;
        if (!ai) return false;
        return ai.mode === 'goto' || ai.mode === 'look' || ai.mode === 'home';
    }

    maybeNpcTakeFood() {
        if (!this.interactives || this.isStealing || this.isTransitioning) return;
        this._foodAcc = (this._foodAcc || 0) + this.game.loop.delta;
        if (this._foodAcc < 400) return;
        this._foodAcc = 0;
        if (!window.ItemDB || !ItemDB.isFood) return;
        const t = (CONFIG.TIME) || {};
        const wait = t.FOOD_WAIT_MS != null ? t.FOOD_WAIT_MS : (2 * 60 * 1000);
        const see = t.FOOD_SEE != null ? t.FOOD_SEE : 240;
        const now = GameState.gameTime();
        const foods = [];
        this.interactives.forEach(o => {
            const d = o && o.itemData;
            if (!d || d.action !== 'pickup' || !ItemDB.isFood(d)) return;
            if (now - (d.droppedAt || 0) < wait) return;
            foods.push(o);
        });
        foods.forEach(food => {
            const fid = food.itemData && food.itemData.id;
            const claimed = this.interactives.some(n => n && n._ai && n._ai.mode === 'pickup' && n._ai.dropId === fid);
            if (claimed) return;
            let best = null, bestD = see;
            this.interactives.forEach(npc => {
                if (!this.isPersonNpc(npc)) return;
                if (this.isNpcBusy(npc)) return;
                if (npc._ai && npc._ai.mode === 'pickup') return;
                if (GameState.isNpcSick && GameState.isNpcSick(this.npcIdOf(npc))) return;
                const mv = this.npcMoveOf(npc);
                if (mv && mv.pickFood === false) return;
                const d = Phaser.Math.Distance.Between(npc.x, npc.y, food.x, food.y);
                if (d <= bestD) {
                    bestD = d;
                    best = npc;
                }
            });
            if (!best) return;
            if (best._homeX == null) {
                best._homeX = best.x;
                best._homeY = best.y;
            }
            best._ai = { mode: 'pickup', tx: food.x, ty: food.y, dropId: fid, stuck: 0 };
        });
    }

    npcFinishPickup(obj, ai) {
        const fid = ai && ai.dropId;
        const food = (this.interactives || []).find(o => o && o.itemData && o.itemData.id === fid);
        if (!food) {
            this.sendNpcHome(obj);
            return;
        }
        const poisoned = !!food.itemData.poisoned;
        const name = (window.ItemDB && ItemDB.displayName) ? ItemDB.displayName(food.itemData) : (food.itemData.name || '食物');
        this.removeGroundObj(food);
        if (poisoned) {
            const nid = this.npcIdOf(obj);
            if (nid && GameState.makeNpcSick) GameState.makeNpcSick(nid);
            this.tintSickNpc(obj, true);
            this.showToast(this.npcName(obj) + '捡走了' + name + '，病倒了');
        } else {
            this.showToast(this.npcName(obj) + '捡走了' + name);
        }
        this.sendNpcHome(obj);
    }

    removeGroundObj(obj) {
        if (!obj) return;
        const idx = (this.interactives || []).indexOf(obj);
        if (idx >= 0) this.interactives.splice(idx, 1);
        if (this.occluders) {
            const oi = this.occluders.indexOf(obj);
            if (oi >= 0) this.occluders.splice(oi, 1);
        }
        if (obj.itemData && obj.itemData.id) GameState.removeGroundDrop(this.currentMapKey, obj.itemData.id);
        if (obj.prompt) obj.prompt.destroy();
        if (obj.disableHighlight) obj.disableHighlight();
        obj.destroy();
    }

    /**
     * 显示一个浮动提示（屏幕中上方）
     */
    showToast(msg) {
        const cam = this.cameras.main;
        const ui = window.UiTheme || {};
        const font = ui.font || '"Microsoft YaHei",sans-serif';
        const toast = this.add.text(cam.width / 2, 72, msg, {
            fontFamily: font,
            fontSize: '17px',
            fill: ui.ink || '#e8dcc8',
            backgroundColor: '#16120edd',
            padding: { x: 16, y: 10 },
            align: 'center',
            wordWrap: { width: Math.min(560, cam.width - 80) }
        }).setOrigin(0.5).setScrollFactor(0).setDepth(50050);
        const zoom = cam.zoom || 1;
        this.pinToScreen(toast, cam.width / 2, 72, zoom);
        const endY = cam.height * 0.5 + (52 - cam.height * 0.5) / zoom;

        this.tweens.add({
            targets: toast,
            alpha: 0,
            y: endY,
            duration: 1600,
            delay: 700,
            onComplete: () => toast.destroy()
        });
    }

    _pollGuideKeys() {
        if (!this._guideOpen) return;
        if ((this.spaceKey && Phaser.Input.Keyboard.JustDown(this.spaceKey))
            || (this.eKey && Phaser.Input.Keyboard.JustDown(this.eKey))
            || (this.hKey && Phaser.Input.Keyboard.JustDown(this.hKey))) {
            this.closeGuide();
        }
    }

    openGuide(firstTime) {
        if (this._guideOpen) return;
        if (this.scene.isActive(CONFIG.SCENES.DIALOGUE) || this.scene.isActive(CONFIG.SCENES.BATTLE)
            || this.scene.isActive(CONFIG.SCENES.STEAL) || this.scene.isActive(CONFIG.SCENES.BACKPACK)
            || this.scene.isActive(CONFIG.SCENES.SHOP)) return;

        this._guideOpen = true;
        this._guideManual = !firstTime;
        const cam = this.cameras.main;
        const W = cam.width;
        const H = cam.height;
        const zoom = cam.zoom || 1;
        const ui = window.UiTheme || {};
        const font = ui.font || '"Microsoft YaHei",sans-serif';
        const root = this.add.container(0, 0).setDepth(60000).setScrollFactor(0);
        this._guideRoot = root;

        const dim = this.add.rectangle(W / 2, H / 2, W + 8, H + 8, 0x0a0806, 0.72)
            .setInteractive();
        root.add(dim);

        const panelW = Math.min(560, W - 48);
        const panelH = Math.min(460, H - 40);
        const px = W / 2 - panelW / 2;
        const py = H / 2 - panelH / 2;
        const panel = this.add.graphics();
        panel.fillStyle(0x16120e, 0.94);
        panel.fillRoundedRect(px, py, panelW, panelH, 12);
        panel.lineStyle(1.5, 0xc4a574, 0.65);
        panel.strokeRoundedRect(px, py, panelW, panelH, 12);
        panel.lineStyle(2, 0xb8955a, 0.45);
        panel.lineBetween(px + 28, py + 8, px + 120, py + 8);
        root.add(panel);

        let y = py + 28;
        root.add(this.add.text(W / 2, y, window.t('guide.title', '盗亦有道'), {
            fontFamily: font, fontSize: '30px', fill: ui.gold || '#e0c078', fontStyle: 'bold'
        }).setOrigin(0.5, 0));
        y += 42;
        root.add(this.add.text(W / 2, y, window.t('guide.subtitle', '中世纪乡下偷窃 RPG · 作品集试玩'), {
            fontFamily: font, fontSize: '14px', fill: ui.muted || '#9a8f7e'
        }).setOrigin(0.5, 0));
        y += 36;

        const body = window.t('guide.controls', '【操作】\nWASD 移动 · Shift 跑 · E 互动 · Tab 背包')
            + '\n\n' + window.t('guide.suggest', '【建议体验 · 约 5～10 分钟】\n1. 跟村民说话，听听村里的事\n2. 拾取背包，按 Tab 整理格子\n3. 试着开锁搜箱（小心被人看见）\n4. 被盘问时可辩解、逃跑或伏法\n5. 接几个挂在 NPC 身上的任务')
            + '\n\n' + window.t('guide.fine', '伏法会罚款并挂上限时减益，通缉清除。')
            + '\n' + window.t('guide.flee', '逃跑会提高通缉等级。');
        root.add(this.add.text(px + 28, y, body, {
            fontFamily: font,
            fontSize: '15px',
            fill: ui.ink || '#e8dcc8',
            lineSpacing: 6,
            wordWrap: { width: panelW - 56 }
        }).setOrigin(0, 0));

        root.add(this.add.text(W / 2, py + panelH - 22, window.t('guide.start', '按 空格 / E 开始        之后可按 H 再看'), {
            fontFamily: font, fontSize: '14px', fill: ui.goldDim || '#a89060'
        }).setOrigin(0.5, 1));

        // 手动打开总览（H）时提供重播新手教程入口
        if (this._guideManual && window.TutSys) {
            const replay = this.add.text(W / 2, py + panelH - 50, window.t('guide.replay', '重播新手教程'), {
                fontFamily: font, fontSize: '15px', fill: ui.gold || '#e0c078', fontStyle: 'bold'
            }).setOrigin(0.5, 1).setInteractive({ useHandCursor: true });
            replay.on('pointerdown', () => {
                this.closeGuide();
                if (this.currentMapKey === WorldManager.getStartMap()) {
                    this.tut = TutSys.attach(this, { force: true });
                    if (this.tut) this.tut.onDone = () => { this.tut = null; };
                } else {
                    this.showToast(window.t('guide.backHint', '先回到新手村谷仓，再按 H 重播教程'));
                }
            });
            root.add(replay);
        }

        this.pinToScreen(root, 0, 0, zoom);
    }

    closeGuide() {
        if (!this._guideOpen) return;
        this._guideOpen = false;
        if (this._guideRoot) {
            this._guideRoot.destroy(true);
            this._guideRoot = null;
        }
        // 首次关闭总览后启动交互式教程；手动打开的总览不重复启动
        if (!this._guideManual && window.TutSys && GameState.isGuideDone && !GameState.isGuideDone()) {
            this.tut = TutSys.attach(this);
            if (this.tut) this.tut.onDone = () => { this.tut = null; };
        }
        if (!this._guideManual) this.showToast(window.t('guide.toast', '去跟附近的人说话，或先拾取背包'));
        this._guideManual = false;
    }
}

