/* =====================================================================
 * 世界管理器（WorldManager.js）
 * =====================================================================
 * 作用：读取编辑器保存的 world.json，在游戏里把一张地图"搭"出来。
 *       它是"编辑器画的"和"游戏里跑的"之间的桥梁。
 *
 * 职责：
 *   1. 加载 world.json（所有地图配置）
 *   2. buildMap(scene, key)：在指定场景里搭建一张地图
 *      - 铺背景图（可选，整张大图，如谷仓）
 *      - 铺瓦片（网格拼图）
 *      - 放建筑（图片 + 碰撞）
 *      - 放墙（矩形碰撞）
 *      - 放物品（可互动物体）
 *      - 设置物理边界
 *      - 可行走区域 = 背景图矩形 ∪ 所有瓦片矩形（空白处走不过去）
 *   3. 起始地图：world.startMap，没有就用第一张
 *   4. 记上次位置：存到浏览器本地（localStorage），下次回到上次的位置
 *   5. 建筑/摆件按「脚底 Y」（可调 sortAnchor）设深度，和玩家比前后遮挡
 *      建筑在遮挡线拆成两层：线上挡人，线下贴地，不连瓦片一起挡
 *   6. 超大拼接图（streamTiles）不一次铺完，由 WorldTileStream 按镜头加载
 *
 * 贴图 key 约定（PreloadScene 按这个约定加载）：
 *   背景图：'bg:' + mapKey       来自 assets/images/maps/<background>
 *   瓦片：  'tile:' + 文件名      来自 assets/images/maps/<文件名>
 *   建筑：  'building:' + 文件名  来自 assets/images/buildings/<文件名>
 *   摆件：  'prop_' + 文件名      来自 assets/images/props/<文件名>
 * ===================================================================== */
const WorldManager = {
    world: { maps: {} },   // 世界数据（world.json 内容）
    currentMapKey: null,   // 当前所在地图
    _loaded: false,        // 是否已加载过 world.json

    /**
     * 加载 world.json（只加载一次，之后用缓存）
     */
    async load() {
        if (this._loaded) return this.world;
        let loaded = false;
        try {
            const res = await fetch('/get-config?name=world&t=' + Date.now(), { cache: 'no-store' });
            const text = await res.text();
            if (text) {
                this.world = JSON.parse(text);
                loaded = true;
            }
        } catch (e) { /* 静态托管无此 API，走本地 JSON */ }
        if (!loaded) {
            try {
                const res = await fetch('assets/configs/world.json?t=' + Date.now());
                const text = await res.text();
                this.world = text ? JSON.parse(text) : { maps: {} };
            } catch (e2) {
                console.error('WorldManager: 读取 world.json 失败', e2);
                this.world = { maps: {} };
            }
        }
        if (!this.world.maps) this.world.maps = {};
        this._loaded = true;
        return this.world;
    },

    /**
     * 收集 world.json 里引用到的所有图片文件名，供 PreloadScene 加载
     * 返回 { backgrounds:[{key, path}], tiles:[{key,path}], buildings:[{key,path}], items:[{key,path}] }
     */
    collectAssets() {
        const out = { backgrounds: [], tiles: [], buildings: [], items: [] };
        const tileSet = new Set(), buildingSet = new Set(), itemSet = new Set(), npcSet = new Set();
        for (const key in this.world.maps) {
            const m = this.world.maps[key];
            // 背景图
            if (m.background) {
                out.backgrounds.push({ key: 'mapbg_' + key, path: 'assets/images/maps/' + m.background });
            }
            // 流式大地图的地砖开局不读，走近再加载（见 WorldTileStream）
            if (!(window.WorldTileStream && WorldTileStream.shouldStream(m))) {
                (m.tiles || []).forEach(t => { if (t.image) tileSet.add(t.image); });
            }
            // 建筑
            (m.buildings || []).forEach(b => { if (b.image) buildingSet.add(b.image); });
            // 物品：对话 NPC 用立绘（npcs 文件夹），其余摆件用 props
            (m.items || []).forEach(it => {
                if (!it.image) return;
                if (it.action === 'dialogue' || it.action === 'shop') npcSet.add(it.image);
                else itemSet.add(it.image);
            });
        }
        tileSet.forEach(fn => out.tiles.push({ key: 'tile:' + fn, path: 'assets/images/maps/' + fn }));
        buildingSet.forEach(fn => out.buildings.push({ key: 'building:' + fn, path: 'assets/images/buildings/' + fn }));
        itemSet.forEach(fn => out.items.push({ key: 'prop_' + fn, path: 'assets/images/props/' + fn }));
        // 对话/商店摆件：地图占位图常在 props（game-map-prop），真人立绘在 npcs
        npcSet.forEach(fn => {
            const looksLikeProp = /game-map-prop|prop-sprite|prop_/i.test(fn);
            out.items.push({
                key: 'prop_' + fn,
                path: (looksLikeProp ? 'assets/images/props/' : 'assets/images/npcs/') + fn
            });
        });
        return out;
    },

    /**
     * 获取起始地图 key：优先 world.startMap，没有就用第一张
     */
    getStartMap() {
        if (this.world.startMap && this.world.maps[this.world.startMap]) return this.world.startMap;
        const keys = Object.keys(this.world.maps);
        return keys.length > 0 ? keys[0] : null;
    },

    /**
     * 计算地图边界（物理世界大小）
     * 有 map.width/height 时以 (0,0) 那块为底；再把瓦片/建筑等包进来（含负坐标）。
     * 返回 { x, y, width, height }，左上角可以不是 (0,0)。
     */
    computeBounds(map) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const pushRect = (x, y, w, h) => {
            if (x == null || y == null || !isFinite(x) || !isFinite(y)) return;
            const ww = w || 0, hh = h || 0;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + ww);
            maxY = Math.max(maxY, y + hh);
        };
        if (map.width && map.height) pushRect(0, 0, map.width, map.height);
        const gs = map.gridSize || 64;
        (map.tiles || []).forEach(t => {
            pushRect(t.col * gs, t.row * gs, (t.w || t.spanW || 1) * gs, (t.h || t.spanH || 1) * gs);
        });
        (map.buildings || []).forEach(b => pushRect(b.x, b.y, b.w, b.h));
        (map.walls || []).forEach(w => pushRect(w.x, w.y, w.w, w.h));
        (map.items || []).forEach(it => pushRect(it.x, it.y, it.w, it.h));
        (map.portals || []).forEach(p => pushRect(p.x, p.y, p.w, p.h));
        (map.zones || []).forEach(z => pushRect(z.x, z.y, z.w, z.h));
        if (map.spawn) pushRect(map.spawn.x, map.spawn.y, 0, 0);
        if (!isFinite(minX)) return { x: 0, y: 0, width: 512, height: 512 };
        return {
            x: minX,
            y: minY,
            width: Math.max(64, maxX - minX),
            height: Math.max(64, maxY - minY)
        };
    },

    /**
     * 可行走矩形：背景图覆盖的整块 + 每块瓦片。
     * 没有瓦片也没有背景时返回空数组（调用方按整张图能走处理，避免卡死）。
     */
    collectWalkableRects(map, scene, mapKey) {
        const rects = [];
        const gs = map.gridSize || 64;
        (map.tiles || []).forEach(t => {
            if (!t) return;
            rects.push({
                x: t.col * gs,
                y: t.row * gs,
                w: (t.w || t.spanW || 1) * gs,
                h: (t.h || t.spanH || 1) * gs
            });
        });
        if (map.background) {
            const scale = map.bgScale || 1;
            const texKey = 'mapbg_' + (mapKey || map.key || '');
            let bw = 0, bh = 0;
            if (scene && scene.textures && scene.textures.exists(texKey)) {
                const img = scene.textures.get(texKey).getSourceImage();
                if (img && img.width && img.height) {
                    bw = img.width * scale;
                    bh = img.height * scale;
                }
            }
            if (!(bw > 0 && bh > 0) && map.width && map.height) {
                bw = map.width;
                bh = map.height;
            }
            if (bw > 0 && bh > 0) rects.push({ x: 0, y: 0, w: bw, h: bh });
        }
        return rects;
    },

    pointWalkable(x, y, rects) {
        if (!rects || !rects.length) return true;
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
        }
        return false;
    },

    /** 用脚底碰撞盒中心判断：人可以略探出瓦片边，出生点不容易卡住 */
    isBodyCenterWalkable(body, rects) {
        if (!body) return true;
        if (!rects || !rects.length) return true;
        return this.pointWalkable(body.center.x, body.center.y, rects);
    },

    pointHitsAnyWall(px, py, walls, hw, hh) {
        if (!walls || !walls.length) return false;
        for (let i = 0; i < walls.length; i++) {
            if (this.pointHitsWall(px, py, walls[i], hw, hh)) return true;
        }
        return false;
    },

    /**
     * 找一个能站的点：在瓦片上、不在墙里。优先往房间内侧（prefer）挪。
     * x/y 是碰撞盒中心（脚底），不是精灵中心。
     */
    snapSpawnFree(x, y, rects, walls, preferX, preferY, hw, hh) {
        const pad = 8;
        const tw = (hw || 12) + pad;
        const th = (hh || 12) + pad;
        const ok = (px, py) => {
            if (rects && rects.length && !this.pointWalkable(px, py, rects)) return false;
            if (walls && walls.length && this.pointHitsAnyWall(px, py, walls, tw, th)) return false;
            return true;
        };
        if (ok(x, y)) return { x: x, y: y };
        const pdx = (preferX != null && isFinite(preferX) ? preferX : x) - x;
        const pdy = (preferY != null && isFinite(preferY) ? preferY : y) - y;
        const plen = Math.hypot(pdx, pdy);
        if (plen > 1e-6) {
            const ux = pdx / plen, uy = pdy / plen;
            for (let d = 4; d <= 180; d += 4) {
                const px = x + ux * d, py = y + uy * d;
                if (ok(px, py)) return { x: px, y: py };
            }
        }
        for (let r = 6; r <= 200; r += 6) {
            for (let a = 0; a < 16; a++) {
                const ang = a * Math.PI / 8;
                const px = x + Math.cos(ang) * r;
                const py = y + Math.sin(ang) * r;
                if (ok(px, py)) return { x: px, y: py };
            }
        }
        return { x: x, y: y };
    },

    /** 把点吸到最近的可行走矩形上（存档落在空白处、出入口落地偏了时用） */
    snapToWalkable(x, y, rects) {
        if (!rects || !rects.length || this.pointWalkable(x, y, rects)) return { x, y };
        let bestX = x, bestY = y, bestD = Infinity;
        for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            const cx = Math.max(r.x, Math.min(x, r.x + r.w));
            const cy = Math.max(r.y, Math.min(y, r.y + r.h));
            const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
            if (d < bestD) { bestD = d; bestX = cx; bestY = cy; }
        }
        return { x: bestX, y: bestY };
    },

    /**
     * 物理步进后：走出可行走区域则退回，并尽量沿边滑。
     * 返回应记为“上一帧合法位置”的坐标。
     */
    constrainSpriteToWalkable(sprite, lastX, lastY, rects) {
        if (!sprite || !sprite.body || !rects || !rects.length) {
            return sprite ? { x: sprite.x, y: sprite.y } : { x: lastX, y: lastY };
        }
        if (this.isBodyCenterWalkable(sprite.body, rects)) {
            return { x: sprite.x, y: sprite.y };
        }
        const ox = sprite.x, oy = sprite.y;
        const vx = sprite.body.velocity.x;
        const vy = sprite.body.velocity.y;
        sprite.body.reset(lastX, oy);
        sprite.body.setVelocity(0, vy);
        if (this.isBodyCenterWalkable(sprite.body, rects)) {
            return { x: sprite.x, y: sprite.y };
        }
        sprite.body.reset(ox, lastY);
        sprite.body.setVelocity(vx, 0);
        if (this.isBodyCenterWalkable(sprite.body, rects)) {
            return { x: sprite.x, y: sprite.y };
        }
        sprite.body.reset(lastX, lastY);
        sprite.body.setVelocity(0, 0);
        return { x: lastX, y: lastY };
    },

    wallShapeOf(w) {
        return (w && (w.shape === 'circle' || w.shape === 'diamond')) ? w.shape : 'rect';
    },

    bodyHalfSize(body) {
        let hw = 0, hh = 0;
        if (body) {
            if (body.halfWidth > 0) hw = body.halfWidth;
            else if (body.width > 0) hw = body.width / 2;
            if (body.halfHeight > 0) hh = body.halfHeight;
            else if (body.height > 0) hh = body.height / 2;
        }
        if (!(hw > 0)) hw = 12;
        if (!(hh > 0)) hh = 12;
        return { hw: hw, hh: hh };
    },

    wallNorm(px, py, w, hw, hh) {
        const rx = w.w / 2 + hw;
        const ry = w.h / 2 + hh;
        if (!(rx > 0) || !(ry > 0)) return null;
        return {
            cx: w.x + w.w / 2,
            cy: w.y + w.h / 2,
            rx: rx,
            ry: ry,
            nx: (px - (w.x + w.w / 2)) / rx,
            ny: (py - (w.y + w.h / 2)) / ry
        };
    },

    wallInsideAmt(n, shape) {
        if (shape === 'circle') return Math.hypot(n.nx, n.ny);
        if (shape === 'diamond') return Math.abs(n.nx) + Math.abs(n.ny);
        return Math.max(Math.abs(n.nx), Math.abs(n.ny));
    },

    /** 严格内部才算撞墙；贴边不算 */
    pointHitsWall(px, py, w, hw, hh) {
        const n = this.wallNorm(px, py, w, hw, hh);
        if (!n) return false;
        return this.wallInsideAmt(n, this.wallShapeOf(w)) < 1;
    },

    bodyHitsShapedWall(body, w) {
        if (!body || !w) return false;
        const { hw, hh } = this.bodyHalfSize(body);
        return this.pointHitsWall(body.center.x, body.center.y, w, hw, hh);
    },

    bodyHitsAnyWall(body, walls) {
        if (!body || !walls || !walls.length) return false;
        const { hw, hh } = this.bodyHalfSize(body);
        for (let i = 0; i < walls.length; i++) {
            if (this.pointHitsWall(body.center.x, body.center.y, walls[i], hw, hh)) return true;
        }
        return false;
    },

    wallOutwardNormal(px, py, w, hw, hh) {
        const n = this.wallNorm(px, py, w, hw, hh);
        if (!n) return null;
        const shape = this.wallShapeOf(w);
        let ox, oy;
        if (shape === 'circle') {
            ox = n.nx / n.rx;
            oy = n.ny / n.ry;
        } else if (shape === 'diamond') {
            ox = (n.nx === 0 ? 0 : Math.sign(n.nx)) / n.rx;
            oy = (n.ny === 0 ? 0 : Math.sign(n.ny)) / n.ry;
        } else if (Math.abs(n.nx) > Math.abs(n.ny)) {
            ox = n.nx === 0 ? 1 : Math.sign(n.nx);
            oy = 0;
        } else {
            ox = 0;
            oy = n.ny === 0 ? -1 : Math.sign(n.ny);
        }
        const len = Math.hypot(ox, oy);
        if (len < 1e-6) return { x: 0, y: -1 };
        return { x: ox / len, y: oy / len };
    },

    /** 只改坐标，不清速度（reset 会把速度打成 0，贴墙就会每帧撞进去再弹出） */
    setBodyCenter(sprite, cx, cy) {
        const body = sprite.body;
        const dx = cx - body.center.x;
        const dy = cy - body.center.y;
        if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return false;
        sprite.x += dx;
        sprite.y += dy;
        body.x += dx;
        body.y += dy;
        if (body.center) body.center.set(cx, cy);
        return true;
    },

    /** 脚底相对精灵中心的偏移。刚创建时 body.center 往往还没算上 offset，不能信。 */
    playerBodyCenterOffset(sprite) {
        const body = sprite && sprite.body;
        if (body && typeof body.updateFromGameObject === 'function') body.updateFromGameObject();
        if (body && body.center) {
            const dx = body.center.x - sprite.x;
            const dy = body.center.y - sprite.y;
            if (Math.abs(dy) > 2 || Math.abs(dx) > 2) return { dx: dx, dy: dy };
        }
        const s = (sprite.scaleY > 0) ? sprite.scaleY : 1;
        const frame = (CONFIG && CONFIG.PLAYER_FRAME) ? CONFIG.PLAYER_FRAME : 256;
        const displayW = sprite.displayWidth || frame * s;
        const displayH = sprite.displayHeight || frame * s;
        const bw = (body && body.width > 0) ? body.width : 40 * s;
        const bh = (body && body.height > 0) ? body.height : 40 * s;
        const ox = sprite.originX != null ? sprite.originX : 0.5;
        const oy = sprite.originY != null ? sprite.originY : 0.5;
        return {
            dx: -ox * displayW + (displayW - bw) / 2 + bw / 2,
            dy: -oy * displayH + (displayH - bh) + bh / 2
        };
    },

    placePlayerBodyAt(sprite, cx, cy) {
        if (!sprite) return;
        const o = this.playerBodyCenterOffset(sprite);
        sprite.x = cx - o.dx;
        sprite.y = cy - o.dy;
        const body = sprite.body;
        if (body && typeof body.updateFromGameObject === 'function') body.updateFromGameObject();
        else if (body) this.setBodyCenter(sprite, cx, cy);
    },

    stripInwardVelocity(sprite, nx, ny) {
        const body = sprite.body;
        const vn = body.velocity.x * nx + body.velocity.y * ny;
        if (vn < 0) {
            body.setVelocity(body.velocity.x - vn * nx, body.velocity.y - vn * ny);
        }
    },

    /** 推出墙外约 0.5 像素，并去掉往墙里的速度，贴边可以滑 */
    resolveWallPoint(px, py, w, hw, hh) {
        const n = this.wallNorm(px, py, w, hw, hh);
        if (!n) return null;
        const shape = this.wallShapeOf(w);
        const amt = this.wallInsideAmt(n, shape);
        if (amt >= 1) return null;
        const skin = 0.5;
        if (shape === 'circle') {
            if (amt < 1e-6) return { x: n.cx, y: n.cy - n.ry - skin, nx: 0, ny: -1 };
            const ux = n.nx / amt, uy = n.ny / amt;
            const s = 1 + skin / Math.max(n.rx, n.ry);
            const gx = ux / n.rx, gy = uy / n.ry;
            const glen = Math.hypot(gx, gy) || 1;
            return { x: n.cx + ux * s * n.rx, y: n.cy + uy * s * n.ry, nx: gx / glen, ny: gy / glen };
        }
        if (shape === 'diamond') {
            if (amt < 1e-6) return { x: n.cx, y: n.cy - n.ry - skin, nx: 0, ny: -1 };
            const k = (1 + skin / Math.max(n.rx, n.ry)) / amt;
            const nor = this.wallOutwardNormal(px, py, w, hw, hh);
            return { x: n.cx + n.nx * k * n.rx, y: n.cy + n.ny * k * n.ry, nx: nor.x, ny: nor.y };
        }
        const ox = n.rx - Math.abs(px - n.cx);
        const oy = n.ry - Math.abs(py - n.cy);
        if (ox < oy) {
            const sx = (px === n.cx) ? 1 : Math.sign(px - n.cx);
            return { x: n.cx + sx * (n.rx + skin), y: py, nx: sx, ny: 0 };
        }
        const sy = (py === n.cy) ? 1 : Math.sign(py - n.cy);
        return { x: px, y: n.cy + sy * (n.ry + skin), nx: 0, ny: sy };
    },

    /**
     * 墙：扫这一步防穿，重叠则轻推出去，只削掉往墙里的速度。
     */
    constrainSpriteToShapedWalls(sprite, lastX, lastY, walls) {
        if (!sprite || !sprite.body || !walls || !walls.length) {
            return sprite ? { x: sprite.x, y: sprite.y } : { x: lastX, y: lastY };
        }
        const { hw, hh } = this.bodyHalfSize(sprite.body);
        const lastCX = sprite.body.center.x - (sprite.x - lastX);
        const lastCY = sprite.body.center.y - (sprite.y - lastY);
        const hits = (x, y) => {
            for (let i = 0; i < walls.length; i++) {
                if (this.pointHitsWall(x, y, walls[i], hw, hh)) return true;
            }
            return false;
        };

        let cx = sprite.body.center.x, cy = sprite.body.center.y;
        const lastFree = !hits(lastCX, lastCY);

        if (lastFree && !hits(cx, cy)) {
            const dist = Math.hypot(cx - lastCX, cy - lastCY);
            const steps = Math.max(1, Math.ceil(dist / 4));
            let fx = lastCX, fy = lastCY, tunneled = false;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const x = lastCX + (cx - lastCX) * t;
                const y = lastCY + (cy - lastCY) * t;
                if (hits(x, y)) { tunneled = true; break; }
                fx = x; fy = y;
            }
            if (tunneled) this.setBodyCenter(sprite, fx, fy);
        }

        for (let iter = 0; iter < 8; iter++) {
            let moved = false;
            cx = sprite.body.center.x;
            cy = sprite.body.center.y;
            for (let i = 0; i < walls.length; i++) {
                const out = this.resolveWallPoint(cx, cy, walls[i], hw, hh);
                if (out) {
                    let nx = out.nx, ny = out.ny;
                    const nlen = Math.hypot(nx, ny);
                    if (nlen > 1e-6) { nx /= nlen; ny /= nlen; }
                    else { nx = 0; ny = -1; }
                    this.setBodyCenter(sprite, out.x, out.y);
                    this.stripInwardVelocity(sprite, nx, ny);
                    cx = sprite.body.center.x;
                    cy = sprite.body.center.y;
                    moved = true;
                }
            }
            if (!moved) break;
        }

        // 贴着墙走：即使这一帧没嵌进去，也削掉朝墙的速度，下一帧才不会又撞进去抖
        cx = sprite.body.center.x;
        cy = sprite.body.center.y;
        for (let i = 0; i < walls.length; i++) {
            const n = this.wallNorm(cx, cy, walls[i], hw, hh);
            if (!n) continue;
            const amt = this.wallInsideAmt(n, this.wallShapeOf(walls[i]));
            if (amt > 1.08 || amt < 0.92) continue;
            const nor = this.wallOutwardNormal(cx, cy, walls[i], hw, hh);
            if (nor) this.stripInwardVelocity(sprite, nor.x, nor.y);
        }

        if (hits(sprite.body.center.x, sprite.body.center.y) && lastFree) {
            this.setBodyCenter(sprite, lastCX, lastCY);
            const dx = cx - lastCX, dy = cy - lastCY;
            const len = Math.hypot(dx, dy);
            if (len > 1e-6) this.stripInwardVelocity(sprite, dx / len, dy / len);
        }
        return { x: sprite.x, y: sprite.y };
    },

    /**
     * 脚底 Y → 渲染深度。sortAnchor：0=顶边，1=底边（默认底边）
     */
    sortYOfRect(x, y, w, h, sortAnchor) {
        const a = (sortAnchor != null && isFinite(sortAnchor)) ? sortAnchor : 1;
        return y + h * Math.max(0, Math.min(1, a));
    },

    sortAnchorOf(kind, obj) {
        const img = obj && obj.image;
        const table = this.world && this.world.sortAnchors && this.world.sortAnchors[kind];
        if (img && table && table[img] != null && isFinite(table[img])) return table[img];
        if (obj && obj.sortAnchor != null && isFinite(obj.sortAnchor)) return obj.sortAnchor;
        return 1;
    },

    ySortDepth(sortY) {
        const base = CONFIG.Y_SORT_BASE != null ? CONFIG.Y_SORT_BASE : 1000;
        return base + sortY;
    },

    layerZ(z) {
        const tie = CONFIG.Z_SORT_TIE != null ? CONFIG.Z_SORT_TIE : 0.01;
        return ((z != null && isFinite(z)) ? z : 0) * tie;
    },

    /**
     * 建筑/高物：可在遮挡线处拆成两层。
     * 摆件不要拆——下半段若钉在贴地层，其它摆件会从它「腿上」盖过去，前后就错。
     * 拆开时下半段也跟同一条遮挡线排序，只比上半段略低，不当成地板。
     */
    placeLayeredImage(scene, x, y, w, h, texKey, sortAnchor, z, opts) {
        const noSplit = !!(opts && opts.noSplit);
        const a = (sortAnchor != null && isFinite(sortAnchor))
            ? Math.max(0, Math.min(1, sortAnchor))
            : 1;
        const sortY = this.sortYOfRect(x, y, w, h, a);
        const zOff = this.layerZ(z);
        const make = () => {
            const img = scene.add.image(x, y, texKey).setOrigin(0, 0);
            img.setDisplaySize(w, h);
            return img;
        };
        const foot = CONFIG.FOOTPRINT_DEPTH != null ? CONFIG.FOOTPRINT_DEPTH : 8;
        const tagOcc = (img, occH) => {
            img._sortY = sortY;
            img._z = (z != null && isFinite(z)) ? z : 0;
            img._occLeft = x;
            img._occTop = y;
            img._occW = w;
            img._occH = occH;
            return img;
        };
        if (a <= 0.01) {
            const img = make();
            img.setDepth(foot + zOff);
            return null;
        }
        if (noSplit || a >= 0.99) {
            const img = make();
            img.setDepth(this.ySortDepth(sortY) + zOff);
            return tagOcc(img, h);
        }
        if (!scene.textures.exists(texKey)) {
            const img = make();
            img.setDepth(this.ySortDepth(sortY) + zOff);
            return tagOcc(img, h);
        }
        const src = scene.textures.get(texKey).getSourceImage();
        const srcW = (src && src.width) ? src.width : 1;
        const srcH = (src && src.height) ? src.height : 1;
        const split = srcH * a;
        const top = make();
        top.setCrop(0, 0, srcW, Math.max(1, split));
        top.setDepth(this.ySortDepth(sortY) + zOff);
        const bot = make();
        bot.setCrop(0, split, srcW, Math.max(1, srcH - split));
        bot.setDepth(this.ySortDepth(sortY) + zOff - 0.05);
        return tagOcc(top, h * a);
    },

    /**
     * 在场景里搭建一张地图
     * @param {Phaser.Scene} scene   所在场景（通常是 GameScene）
     * @param {string} key           地图 key
     * @param {function} onInteract  物品互动派发器 (itemObj, itemData) => void
     * @returns {object} { spawnX, spawnY, width, height, interactives, obstacles }
     */
    buildMap(scene, key, onInteract) {
        const map = this.world.maps[key];
        if (!map) {
            console.error('WorldManager: 找不到地图', key);
            return null;
        }
        this.currentMapKey = key;
        const bounds = this.computeBounds(map);
        if (scene.physics && scene.physics.world) {
            scene.physics.world.setBounds(bounds.x || 0, bounds.y || 0, bounds.width, bounds.height);
        }
        const pad = 512;
        this._sortOriginY = bounds.y - pad;
        this._sortRangeY = Math.max(64, bounds.height + pad * 2);
        const walkableRects = this.collectWalkableRects(map, scene, key);
        const interactives = [];   // 可互动物体列表（给 GameScene 统一更新）
        const occluders = [];      // 能挡在亨利前面的图（建筑上半、摆件）
        const obstacles = scene.physics.add.staticGroup(); // 墙 + 实体建筑的碰撞组

        // ---- 1. 背景图（整张大图，如谷仓）----
        if (map.background) {
            const texKey = 'mapbg_' + key;
            if (scene.textures.exists(texKey)) {
                const bg = scene.add.image(0, 0, texKey).setOrigin(0, 0);
                bg.setScale(map.bgScale || 1);
                bg.setDepth(CONFIG.GROUND_DEPTH != null ? CONFIG.GROUND_DEPTH - 1 : -1000001);
            } else {
                // 贴图没来：先铺一块地板，避免只剩黑屏
                const g = scene.add.rectangle(
                    bounds.x + bounds.width / 2, bounds.y + bounds.height / 2,
                    bounds.width, bounds.height,
                    0x5a4632
                );
                g.setDepth(CONFIG.GROUND_DEPTH != null ? CONFIG.GROUND_DEPTH - 1 : -1000001);
            }
        }

        // ---- 2. 瓦片（网格拼图，铺在背景之上）----
        const gs = map.gridSize || 64;
        if (window.WorldTileStream && WorldTileStream.shouldStream(map)) {
            scene._tileStream = WorldTileStream.create(scene, map);
        } else {
            (map.tiles || []).forEach((t) => {
                const tw = (t.w || t.spanW || 1) * gs;
                const th = (t.h || t.spanH || 1) * gs;
                const tx = t.col * gs;
                const ty = t.row * gs;
                if (window.WorldTileStream) {
                    WorldTileStream.addTileImage(scene, tx, ty, 'tile:' + t.image, tw, th);
                } else {
                    const tileImg = scene.add.image(tx, ty, 'tile:' + t.image).setOrigin(0, 0);
                    tileImg.setDisplaySize(tw, th);
                    tileImg.setDepth(CONFIG.GROUND_DEPTH != null ? CONFIG.GROUND_DEPTH : -1000000);
                }
            });
        }

        // ---- 3. 建筑（图片 + 可选碰撞；遮挡只作用于遮挡线以上）----
        (map.buildings || []).forEach(b => {
            const spr = this.placeLayeredImage(scene, b.x, b.y, b.w, b.h, 'building:' + b.image, this.sortAnchorOf('building', b), b.z);
            if (spr) occluders.push(spr);
            // solid 建筑：加入碰撞组（用静态矩形碰撞体）。默认关，挡路用墙。
            if (b.solid) {
                const body = scene.add.rectangle(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, 0xffffff, 0);
                body.setDepth(0);
                scene.physics.add.existing(body, true); // true=静态
                obstacles.add(body);
            }
        });

        // ---- 4. 墙：三种形状都按形状挡人（不再挂 Arcade，避免和推出互相打架卡住）----
        const shapedWalls = [];
        (map.walls || []).forEach(w => {
            shapedWalls.push(w);
        });

        // ---- 5. 摆件（地图上的可互动物件 / 装饰，图在 props 文件夹）----
        (map.items || []).forEach(it => {
            if (this.shouldSkipItem(key, it)) return;
            const texKey = 'prop_' + it.image;
            // 不可互动的摆件也放图，但不创建 InteractiveObject（纯装饰）
            if (it.interactable === false) {
                const spr = this.placeLayeredImage(scene, it.x, it.y, it.w, it.h, texKey, this.sortAnchorOf('item', it), it.z, { noSplit: true });
                if (spr) occluders.push(spr);
            } else {
                // 可互动：用 InteractiveObject，自动获得高亮 + E提示
                const obj = new InteractiveObject(scene, it.x + it.w / 2, it.y + it.h / 2, texKey, {
                    promptText: WorldManager._promptFor(it),
                    lockLevel: it.lockLevel || 0,
                    onInteract: (o) => onInteract(o, it)
                });
                obj.setDisplaySize(it.w, it.h);
                obj.setOrigin(0.5);
                const itemSortY = this.sortYOfRect(it.x, it.y, it.w, it.h, this.sortAnchorOf('item', it));
                obj.setDepth(this.ySortDepth(itemSortY) + this.layerZ(it.z));
                obj._sortY = itemSortY;
                obj._z = (it.z != null && isFinite(it.z)) ? it.z : 0;
                obj._occLeft = it.x;
                obj._occTop = it.y;
                obj._occW = it.w;
                obj._occH = it.h;
                obj.itemData = it;
                if (it.action === 'dialogue' || it.action === 'shop') {
                    obj._homeX = obj.x;
                    obj._homeY = obj.y;
                    const pScale = (map && map.playerScale > 0) ? map.playerScale : (CONFIG.PLAYER_SCALE || 0.5);
                    if (obj.enableNpcWalk) obj.enableNpcWalk(it, pScale);
                    if (obj._npcId) {
                        obj._occLeft = obj.x - obj.displayWidth / 2;
                        obj._occTop = obj.y - obj.displayHeight / 2;
                        obj._occW = obj.displayWidth;
                        obj._occH = obj.displayHeight;
                        obj._sortY = this.sortYOfRect(obj._occLeft, obj._occTop, obj._occW, obj._occH, this.sortAnchorOf('item', it));
                        obj.setDepth(this.ySortDepth(obj._sortY) + this.layerZ(obj._z));
                    }
                }
                interactives.push(obj);
                occluders.push(obj);
            }
            // solid 摆件：整图挡路。默认关，挡路用墙。
            if (it.solid) {
                const body = scene.add.rectangle(it.x + it.w / 2, it.y + it.h / 2, it.w, it.h, 0xffffff, 0);
                body.setDepth(0);
                scene.physics.add.existing(body, true);
                obstacles.add(body);
            }
        });

        // ---- 6. 出入口（矩形触发区，用 overlap 检测，不挡路）----
        // 出入口是"走过去就触发"的区域，不是碰撞体（玩家能走进去）
        // 这里创建不可见的静态矩形，GameScene 用 physics.add.overlap 检测玩家进入
        const portals = [];   // [{body, data}]
        (map.portals || []).forEach(p => {
            // 没连目标的出入口不触发（避免踩上去没反应）
            if (!p.targetMap || !p.targetPortalId) return;
            const body = scene.add.rectangle(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, 0xffffff, 0);
            body.setDepth(0);
            scene.physics.add.existing(body, true); // 静态（overlap 用）
            portals.push({ body: body, data: p });
        });

        // ---- 6b. 剧情触发区（矩形区域，玩家进入时触发剧情）----
        // 和出入口一样用 overlap 检测，不挡路
        // 实际剧情内容（对话/过场）在 GameScene 按 zone.name 分发，这里只负责"在哪触发"
        const zones = [];   // [{body, data}]
        (map.zones || []).forEach(z => {
            const body = scene.add.rectangle(z.x + z.w / 2, z.y + z.h / 2, z.w, z.h, 0xffffff, 0);
            body.setDepth(0);
            scene.physics.add.existing(body, true); // 静态（overlap 用）
            zones.push({ body: body, data: z });
        });

        // ---- 7. 出生点（默认地图中心或配置的 spawn）----
        let spawnX, spawnY;
        if (map.spawn && isFinite(map.spawn.x) && isFinite(map.spawn.y)) {
            spawnX = map.spawn.x;
            spawnY = map.spawn.y;
        } else {
            spawnX = bounds.x + bounds.width / 2;
            spawnY = bounds.y + bounds.height / 2;
        }
        const snapped = this.snapToWalkable(spawnX, spawnY, walkableRects);
        spawnX = snapped.x;
        spawnY = snapped.y;

        return {
            spawnX, spawnY,
            x: bounds.x, y: bounds.y,
            width: bounds.width, height: bounds.height,
            interactives, obstacles, portals, zones,
            walkableRects, occluders, shapedWalls
        };
    },

    /**
     * 从出入口到达：脚落在门口内侧，不要落在门槛墙正中。
     */
    computeArrivalSpawn(mapKey, portalId) {
        const map = this.world.maps[mapKey];
        if (!map) return null;
        const portal = (map.portals || []).find(p => p.id === portalId);
        if (!portal) return null;
        const cx = portal.x + portal.w / 2;
        const cy = portal.y + portal.h / 2;
        let preferX, preferY;
        if (map.spawn && isFinite(map.spawn.x) && isFinite(map.spawn.y)) {
            preferX = map.spawn.x;
            preferY = map.spawn.y;
        } else {
            preferX = (map.width || 0) / 2;
            preferY = (map.height || 0) / 2;
        }
        let ux = preferX - cx, uy = preferY - cy;
        const len = Math.hypot(ux, uy);
        if (len < 1e-6) { ux = 0; uy = -1; }
        else { ux /= len; uy /= len; }
        const dist = Math.max(portal.w, portal.h) * 0.6 + 28;
        return { x: cx + ux * dist, y: cy + uy * dist };
    },

    /** 已捡走的地上物 / 已拾取的开局背包，进图时不要再刷 */
    shouldSkipItem(mapKey, it) {
        if (!it || !window.GameState) return false;
        if (it.grant === 'backpack' && GameState.get('hasBackpack', false)) return true;
        if (it.action === 'pickup' && it.id && GameState.isPickedMapItem && GameState.isPickedMapItem(mapKey, it.id)) return true;
        return false;
    },

    /**
     * 根据物品行为生成提示文字
     */
    _promptFor(it) {
        switch (it.action) {
            case 'steal': return '按 E 偷窃';
            case 'pickup': return '按 E 拾取';
            case 'open': return '按 E 打开';
            case 'shop': return '按 E 交易';
            case 'dialogue': return '按 E 对话';
            default: return '按 E 互动';
        }
    },

    // ===== 上次位置存档（localStorage）=====
    _storageKey: 'world_lastPos',

    savePosition(key, x, y) {
        try {
            const data = JSON.stringify({ key, x: Math.round(x), y: Math.round(y) });
            localStorage.setItem(this._storageKey, data);
        } catch (e) { /* localStorage 不可用时静默忽略 */ }
    },

    loadPosition() {
        try {
            const data = localStorage.getItem(this._storageKey);
            return data ? JSON.parse(data) : null;
        } catch (e) { return null; }
    },

    clearPosition() {
        try { localStorage.removeItem(this._storageKey); } catch (e) {}
    },

    // ===== 已触发的剧情区记录（localStorage，让"只一次"跨次保留）=====
    // 存一个对象 { "mapKey:zoneId": true, ... }，记录哪些只触发一次的剧情区已经触发过
    _triggeredKey: 'world_triggeredZones',

    _loadTriggered() {
        try {
            return JSON.parse(localStorage.getItem(this._triggeredKey) || '{}');
        } catch (e) { return {}; }
    },

    _saveTriggered(obj) {
        try { localStorage.setItem(this._triggeredKey, JSON.stringify(obj)); } catch (e) {}
    },

    // 某个"只一次"剧情区是否已触发过
    isZoneTriggered(mapKey, zoneId) {
        const t = this._loadTriggered();
        return !!t[mapKey + ':' + zoneId];
    },

    // 标记某个"只一次"剧情区已触发
    markZoneTriggered(mapKey, zoneId) {
        const t = this._loadTriggered();
        t[mapKey + ':' + zoneId] = true;
        this._saveTriggered(t);
    },

    // 清空所有已触发记录（调试用：让所有"只一次"剧情能重新触发）
    clearTriggered() {
        try { localStorage.removeItem(this._triggeredKey); } catch (e) {}
    }
};
