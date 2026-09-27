/* =====================================================================
 * 资源加载场景（PreloadScene.js）
 * 平铺水印滚动底 + 亨利带头村民排着队跑表示进度。
 * ===================================================================== */
class PreloadScene extends Phaser.Scene {
    constructor() {
        super({ key: CONFIG.SCENES.PRELOAD });
    }

    preload() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;
        this._loadProgress = 0;

        // 平铺水印用 DOM+CSS 动画：加载占主线程时合成层仍能顺滑滚
        this.cameras.main.setBackgroundColor('rgba(20,17,14,0)');
        this.showLoadWatermark();
        this.events.once('shutdown', () => this.hideLoadWatermark());
        this.events.once('destroy', () => this.hideLoadWatermark());

        // 轻暗角，中间内容更清楚，水印仍透出来
        this.add.rectangle(width / 2, height / 2, width, height, 0x0a0806, 0.22).setDepth(1);

        const ui = window.UiTheme || {};
        const font = ui.font || '"Microsoft YaHei",sans-serif';
        this.add.text(width / 2, height * 0.18, '盗亦有道', {
            fontFamily: font, fontSize: '36px', fill: ui.gold || '#e0c078', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(5);

        this.loadingText = this.add.text(width / 2, height * 0.26, '正在上路…', {
            fontFamily: font, fontSize: '16px', fill: ui.muted || '#9a8f7e'
        }).setOrigin(0.5).setDepth(5);

        this.percentText = this.add.text(width / 2, height * 0.88, '0%', {
            fontFamily: font, fontSize: '18px', fill: ui.ink || '#e8dcc8'
        }).setOrigin(0.5).setDepth(5);

        const road = this.add.graphics().setDepth(2);
        road.lineStyle(3, 0xc4a574, 0.35);
        road.lineBetween(56, height * 0.72, width - 56, height * 0.72);

        this._runFromX = 70;
        this._runToX = width - 70;
        this._runY = height * 0.68;
        this._loadFollowers = [];
        this._paradeSpacing = 56;

        this.ensureLoadHenryAnims();
        if (this.textures.exists('henry_walk') && this.anims.exists('walk_left')) {
            this.loadHenry = this.add.sprite(this._runFromX, this._runY, 'henry_walk', 16)
                .setDepth(4).setScale(0.55).setFlipX(true);
            this.loadHenry.play('walk_left');
        }

        this._recoveries = [];
        // 先拉几人行走图，加载中途就能排在亨利后面跑
        this.startLoadParade();

        this.load.on('loaderror', (file) => {
            const key = file && file.key;
            const src = file && file.src;
            console.warn('资源加载失败，尝试缩小后重载:', src || key);
            if (key && src) this._recoveries.push(this.recoverTexture(key, src));
            if (key && !this.textures.exists(key)) {
                const g = this.make.graphics({ x: 0, y: 0, add: false });
                g.fillStyle(0x45475a, 1);
                g.fillRect(0, 0, 64, 64);
                g.lineStyle(2, 0xf38ba8, 1);
                g.strokeRect(1, 1, 62, 62);
                g.generateTexture(key, 64, 64);
                g.destroy();
            }
        });
        this.load.on('progress', (value) => {
            this._loadProgress = value;
            this.percentText.setText(parseInt(value * 100) + '%');
            this.updateLoadParade(value);
            if (value < 0.35) this.loadingText.setText('整理行囊…');
            else if (value < 0.7) this.loadingText.setText(window.t('preload.loading', '辨认道路…'));
            else this.loadingText.setText('快到了…');
        });

        const frame = CONFIG.PLAYER_FRAME || 256;
        if (!this.textures.exists('henry_idle')) {
            this.load.spritesheet('henry_idle', 'assets/images/players/henry_idle.png', {
                frameWidth: frame, frameHeight: frame
            });
        }
        if (!this.textures.exists('henry_walk')) {
            this.load.spritesheet('henry_walk', 'assets/images/players/henry_walk.png', {
                frameWidth: frame, frameHeight: frame
            });
            this.load.once('filecomplete-spritesheet-henry_walk', () => {
                this.ensureLoadHenryAnims();
                if (!this.loadHenry && this.anims.exists('walk_left')) {
                    this.loadHenry = this.add.sprite(
                        this._runFromX + (this._runToX - this._runFromX) * (this._loadProgress || 0),
                        this._runY, 'henry_walk', 16
                    ).setDepth(4).setScale(0.55).setFlipX(true);
                    this.loadHenry.play('walk_left');
                    this.updateLoadParade(this._loadProgress || 0);
                }
            });
        }

        this.load.image('border_basic', 'assets/images/props/borders/border_basic.png');
        this.load.image('border_medium', 'assets/images/props/borders/border_medium.png');
        this.load.image('border_advanced', 'assets/images/props/borders/border_advanced.png');
        this.load.image(CONFIG.BACKPACK.BG_KEY, CONFIG.BACKPACK.BG_PATH);
        Object.keys(CONFIG.CHESTS).forEach(lv => {
            const c = CONFIG.CHESTS[lv];
            this.load.image(c.key, c.path);
        });

        const assets = WorldManager.collectAssets();
        assets.backgrounds.forEach(a => {
            if (this.textures.exists(a.key)) this.textures.remove(a.key);
            this.load.image(a.key, a.path);
        });
        assets.tiles.forEach(a => { if (!this.textures.exists(a.key)) this.load.image(a.key, a.path); });
        assets.buildings.forEach(a => { if (!this.textures.exists(a.key)) this.load.image(a.key, a.path); });
        assets.items.forEach(a => { if (!this.textures.exists(a.key)) this.load.image(a.key, a.path); });
        ItemDB.collectImages().forEach(a => {
            if (!this.textures.exists(a.key)) this.load.image(a.key, a.path);
        });
        if (window.DialogueDB && typeof DialogueDB.collectImages === 'function') {
            DialogueDB.collectImages().forEach(a => {
                if (!this.textures.exists(a.key)) this.load.image(a.key, a.path);
            });
        }
        if (window.DialogueDB && typeof DialogueDB.collectSpriteSheets === 'function') {
            DialogueDB.collectSpriteSheets().forEach(a => {
                if (this.textures.exists(a.key)) return;
                if (this._paradeKeys && this._paradeKeys[a.key]) return;
                this._recoveries.push(this.loadNpcSheet(a.key, a.path));
            });
        }

        // ---- 音频：音乐（循环）+ 音效（一次性） ----
        this.load.audio('bgm_main', 'assets/audio/bgm.mp3');
        this.load.audio('bgm_battle', 'assets/audio/battle.mp3');
        this.load.audio('sfx_open_inventory', 'assets/audio/Open inventory.mp3');
        this.load.audio('sfx_close_inventory', 'assets/audio/Close inventory.mp3');
        this.load.audio('sfx_grab', 'assets/audio/Grab.mp3');
        this.load.audio('sfx_drop', 'assets/audio/Drop.mp3');
        this.load.audio('sfx_eat', 'assets/audio/Eat.mp3');
        this.load.audio('sfx_hit', 'assets/audio/Hit.mp3');
        this.load.audio('sfx_item_use', 'assets/audio/Item use sfx.mp3');
        this.load.audio('sfx_key', 'assets/audio/Key.mp3');
        this.load.audio('sfx_open_door', 'assets/audio/Open door.mp3');
        this.load.audio('sfx_open_wood', 'assets/audio/Open Wooden Crate.mp3');
        this.load.audio('sfx_open_iron', 'assets/audio/Open Iron Crate.mp3');
        this.load.audio('sfx_open_gold', 'assets/audio/Open Golden Chest.mp3');
        this.load.audio('sfx_use_potion', 'assets/audio/Use potion sfx.mp3');
    }

    /** 所有有行走图的 NPC 优先加载，排在亨利后面跟着跑 */
    startLoadParade() {
        this._paradeKeys = {};
        this._loadFollowers = this._loadFollowers || [];
        if (!window.DialogueDB || !DialogueDB.npcs) return;
        const candidates = [];
        DialogueDB.npcs.forEach(n => {
            const spec = DialogueDB.spriteOf && DialogueDB.spriteOf(n && n.id);
            if (!spec || !spec.walkKey || !spec.walkFile) return;
            candidates.push({ id: n.id, spec });
        });
        // 间距略疏，宁可队尾出左缘也不要挤成一坨
        const n = Math.max(1, candidates.length);
        this._paradeSpacing = Math.max(64, Math.min(78, Math.floor(220 / Math.max(1, n * 0.35))));

        candidates.forEach((p, index) => {
            this._paradeKeys[p.spec.walkKey] = 1;
            const path = 'assets/images/npcs/' + p.spec.walkFile;
            const job = this.loadNpcSheet(p.spec.walkKey, path).then(() => {
                this.spawnLoadFollower(p.id, p.spec, index);
            });
            this._recoveries.push(job);
        });
    }

    spawnLoadFollower(npcId, spec, index) {
        if (!spec || !this.textures.exists(spec.walkKey)) return;
        if (this._loadFollowers.some(f => f.id === npcId)) return;
        const cols = spec.cols || 8;
        const rows = spec.rows || 5;
        if (!this.sliceSheetFrames(spec.walkKey, cols, rows, true)) return;

        const leftRow = Math.min(2, rows - 1);
        const walkStart = leftRow * cols;
        const animKey = 'load_parade_' + npcId;
        if (!this.anims.exists(animKey)) {
            const frames = [];
            for (let f = 0; f < cols; f++) frames.push({ key: spec.walkKey, frame: walkStart + f });
            this.anims.create({
                key: animKey,
                frames,
                frameRate: 8 + (index % 3),
                repeat: -1
            });
        }

        const spacing = this._paradeSpacing || 56;
        const yOff = ((index % 3) - 1) * 6;
        const spr = this.add.sprite(
            this._runFromX - spacing * (index + 1),
            this._runY + yOff,
            spec.walkKey,
            walkStart
        ).setDepth(3.5 - index * 0.05).setScale(0.54).setFlipX(true);
        spr.play(animKey);
        this._loadFollowers.push({ id: npcId, sprite: spr, index, yOff, animKey });
        this.updateLoadParade(this._loadProgress >= 1 ? 1 : (this._loadProgress || 0));
        if (this._paradeIdle) {
            spr.x = Math.max(36, this._runToX - spacing * (index + 1));
            spr.anims.stop();
        }
    }

    updateLoadParade(value) {
        const v = Math.max(0, Math.min(1, value || 0));
        const hx = this._runFromX + (this._runToX - this._runFromX) * v;
        if (this.loadHenry) this.loadHenry.x = hx;
        const spacing = this._paradeSpacing || 56;
        (this._loadFollowers || []).forEach(f => {
            if (!f.sprite || !f.sprite.active) return;
            f.sprite.x = Math.max(36, hx - spacing * (f.index + 1));
            f.sprite.y = this._runY + (f.yOff || 0);
            f.sprite.setAlpha(f.sprite.x < 48 ? 0.35 : 1);
        });
    }

    idleLoadParade() {
        this._paradeIdle = true;
        if (this.loadHenry) {
            this.loadHenry.x = this._runToX;
            if (this.anims.exists('idle_left')) this.loadHenry.play('idle_left');
            else this.loadHenry.anims.stop();
        }
        (this._loadFollowers || []).forEach(f => {
            if (!f.sprite || !f.sprite.active) return;
            f.sprite.x = Math.max(36, this._runToX - (this._paradeSpacing || 56) * (f.index + 1));
            f.sprite.anims.stop();
        });
    }

    ensureLoadHenryAnims() {
        if (!this.textures.exists('henry_walk')) return;
        if (this.anims.exists('walk_left')) return;
        this.anims.create({
            key: 'walk_left',
            frames: this.anims.generateFrameNumbers('henry_walk', { start: 16, end: 23 }),
            frameRate: 10,
            repeat: -1
        });
    }

    showLoadWatermark() {
        const url = window.__loadWmUrl;
        if (!url) return;
        const parent = document.getElementById('game-container');
        if (!parent) return;
        let el = document.getElementById('load-watermark');
        if (!el) {
            el = document.createElement('div');
            el.id = 'load-watermark';
            el.innerHTML = '<div class="wm-layer"></div>';
            parent.insertBefore(el, parent.firstChild);
        }
        const layer = el.querySelector('.wm-layer');
        const size = window.__loadWmSize || { w: 360, h: 220 };
        if (layer) {
            layer.style.backgroundImage = 'url(' + url + ')';
            layer.style.backgroundSize = size.w + 'px ' + size.h + 'px';
            // 周期跟砖块尺寸对齐，略加快
            layer.style.animationDuration = '11s';
        }
        el.style.display = 'block';
        this._loadWmEl = el;
    }

    hideLoadWatermark() {
        const el = this._loadWmEl || document.getElementById('load-watermark');
        if (el) el.style.display = 'none';
        this._loadWmEl = null;
    }

    update() {}

    loadNpcSheet(key, src) {
        return fetch(src).then(res => {
            if (!res.ok) throw new Error('fetch ' + src);
            return res.blob();
        }).then(blob => createImageBitmap(blob)).then(bmp => {
            const canvas = document.createElement('canvas');
            canvas.width = bmp.width;
            canvas.height = bmp.height;
            canvas.getContext('2d').drawImage(bmp, 0, 0);
            if (bmp.close) bmp.close();
            if (this.textures.exists(key)) this.textures.remove(key);
            this.textures.addCanvas(key, canvas);
        }).catch(err => {
            console.warn('NPC行走图加载失败:', src, err);
        });
    }

    recoverTexture(key, src) {
        const isSheet = String(key).indexOf('npcwalk_') === 0 || String(key).indexOf('npcidle_') === 0;
        if (isSheet) return this.loadNpcSheet(key, src);
        const maxSide = 1024;
        const altSrc = (() => {
            const s = String(src || '');
            if (s.indexOf('/npcs/') >= 0) return s.replace('/npcs/', '/props/');
            if (s.indexOf('/props/') >= 0) return s.replace('/props/', '/npcs/');
            return '';
        })();
        const tryFetch = (url) => fetch(url).then(res => {
            if (!res.ok) throw new Error('fetch ' + url);
            return res.blob();
        });
        return tryFetch(src).catch(() => {
            if (!altSrc || altSrc === src) throw new Error('fetch ' + src);
            return tryFetch(altSrc);
        }).then(blob => createImageBitmap(blob)).then(bmp => {
            let w = bmp.width, h = bmp.height;
            if (w > maxSide || h > maxSide) {
                const s = Math.min(maxSide / w, maxSide / h);
                w = Math.max(1, Math.round(w * s));
                h = Math.max(1, Math.round(h * s));
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
            if (bmp.close) bmp.close();
            if (this.textures.exists(key)) this.textures.remove(key);
            this.textures.addCanvas(key, canvas);
        }).catch(err => {
            console.warn('缩小重载仍失败:', src, err);
        });
    }

    create() {
        this.createHenryAnimations();
        if (!this.textures.exists('item:missing')) {
            const g = this.make.graphics({ x: 0, y: 0, add: false });
            g.fillStyle(0xa6e3a1, 1);
            g.fillRect(0, 0, 64, 64);
            g.lineStyle(3, 0xcba6f7, 1);
            g.strokeRect(2, 2, 60, 60);
            g.generateTexture('item:missing', 64, 64);
            g.destroy();
        }

        if (this.loadingText) this.loadingText.setText('到了。');
        if (this.percentText) this.percentText.setText('100%');
        this.updateLoadParade(1);
        this.idleLoadParade();

        const go = () => this.scene.start(CONFIG.SCENES.GAME);
        const rec = this._recoveries || [];
        const finish = () => {
            this.createNpcWalkAnims();
            this.time.delayedCall(450, go);
        };
        if (!rec.length) {
            finish();
            return;
        }
        if (this.loadingText) this.loadingText.setText('正在认人…');
        Promise.all(rec).then(finish);
    }

    createHenryAnimations() {
        const dirs = [
            { name: 'down',     walkStart: 0,  idleFrame: 0 },
            { name: 'downleft', walkStart: 8,  idleFrame: 1 },
            { name: 'left',     walkStart: 16, idleFrame: 2 },
            { name: 'upleft',   walkStart: 24, idleFrame: 3 },
            { name: 'up',       walkStart: 32, idleFrame: 4 }
        ];
        for (const d of dirs) {
            const walkKey = 'walk_' + d.name;
            if (!this.anims.exists(walkKey) && this.textures.exists('henry_walk')) {
                this.anims.create({
                    key: walkKey,
                    frames: this.anims.generateFrameNumbers('henry_walk', {
                        start: d.walkStart, end: d.walkStart + 7
                    }),
                    frameRate: 10,
                    repeat: -1
                });
            }
            const idleKey = 'idle_' + d.name;
            if (!this.anims.exists(idleKey) && this.textures.exists('henry_idle')) {
                this.anims.create({
                    key: idleKey,
                    frames: [{ key: 'henry_idle', frame: d.idleFrame }],
                    frameRate: 1,
                    repeat: 0
                });
            }
        }
    }
    sliceSheetFrames(key, cols, rows, allowRect) {
        if (!this.textures.exists(key)) return false;
        const tex = this.textures.get(key);
        const src = tex.getSourceImage && tex.getSourceImage();
        if (!src || !src.width || !src.height) return false;
        const cell = CONFIG.PLAYER_FRAME || 256;
        let fw, fh, ox, oy;
        // 行走表是 2400×1792 画布上居中的 8×5×256 格。按不透明外框再切会切歪，走路会拧。
        if (src.width >= cols * cell && src.height >= rows * cell) {
            fw = cell;
            fh = cell;
            ox = Math.floor((src.width - fw * cols) / 2);
            oy = Math.floor((src.height - fh * rows) / 2);
        } else {
            fw = Math.floor(src.width / cols);
            fh = Math.floor(src.height / rows);
            if (fw < 48 || fh < 48) return false;
            if (!allowRect && Math.abs(fw - fh) > Math.max(6, fw * 0.2)) return false;
            ox = Math.floor((src.width - fw * cols) / 2);
            oy = Math.floor((src.height - fh * rows) / 2);
        }
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const i = r * cols + c;
                if (tex.has(i)) continue;
                tex.add(i, 0, ox + c * fw, oy + r * fh, fw, fh);
            }
        }
        return tex.has(0);
    }

    opaqueBounds(img) {
        const w = img.width, h = img.height;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) return { x: 0, y: 0, w: w, h: h };
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, w, h).data;
        const step = (w * h > 800000) ? 2 : 1;
        let minX = w, minY = h, maxX = 0, maxY = 0, hit = 0;
        for (let y = 0; y < h; y += step) {
            for (let x = 0; x < w; x += step) {
                if (data[(y * w + x) * 4 + 3] > 20) {
                    hit++;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (!hit) return { x: 0, y: 0, w: w, h: h };
        maxX = Math.min(w - 1, maxX + step - 1);
        maxY = Math.min(h - 1, maxY + step - 1);
        return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    }

    createNpcWalkAnims() {
        const npcs = (window.DialogueDB && DialogueDB.npcs) || [];
        const dirNames = ['down', 'downleft', 'left', 'upleft', 'up'];
        npcs.forEach(n => {
            const spec = DialogueDB.spriteOf && DialogueDB.spriteOf(n && n.id);
            if (!spec || !spec.walkKey) return;
            const cols = spec.cols || 8;
            const rows = spec.rows || 5;
            if (!this.sliceSheetFrames(spec.walkKey, cols, rows, true)) return;
            if (!spec.idleFromWalk && spec.idleKey !== spec.walkKey) {
                if (!this.sliceSheetFrames(spec.idleKey, 5, 1, true)) return;
            }
            dirNames.forEach((name, i) => {
                if (i >= rows) return;
                const walkStart = i * cols;
                const idleFrame = spec.idleFromWalk ? walkStart : i;
                const idleTex = spec.idleFromWalk ? spec.walkKey : spec.idleKey;
                const walkKey = 'npc_' + n.id + '_walk_' + name;
                const idleKey = 'npc_' + n.id + '_idle_' + name;
                if (!this.anims.exists(walkKey)) {
                    const frames = [];
                    for (let f = 0; f < cols; f++) frames.push({ key: spec.walkKey, frame: walkStart + f });
                    this.anims.create({ key: walkKey, frames: frames, frameRate: 8, repeat: -1 });
                }
                if (!this.anims.exists(idleKey)) {
                    this.anims.create({
                        key: idleKey,
                        frames: [{ key: idleTex, frame: idleFrame }],
                        frameRate: 1,
                        repeat: 0
                    });
                }
            });
        });
    }
}
