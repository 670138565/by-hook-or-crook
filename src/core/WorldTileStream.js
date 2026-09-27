/* =====================================================================
 * 大地图瓦片流式加载（WorldTileStream.js）
 * =====================================================================
 * 100 张 1000px 地砖如果开局全读进显存，大约要几百 MB，容易卡死或粉框。
 * 这里只加载镜头附近的块，走远了卸掉贴图。
 *
 * 地砖深度必须低于所有建筑/摆件（含滚轮往后的负 z）。不要放进 Layer：
 * Phaser 会按子物体自己的 depth(0) 参与排序，草地会盖住往后挪的树和房子。
 * ===================================================================== */
const WorldTileStream = {
    groundDepth() {
        return CONFIG.GROUND_DEPTH != null ? CONFIG.GROUND_DEPTH : -1000000;
    },

    addTileImage(scene, x, y, key, w, h) {
        const img = scene.add.image(x, y, key).setOrigin(0, 0);
        img.setDisplaySize(w, h);
        img.setDepth(WorldTileStream.groundDepth());
        return img;
    },

    create(scene, map) {
        const s = Object.create(WorldTileStream);
        s.scene = scene;
        s.map = map;
        s.gs = map.gridSize || 64;
        s.sprites = Object.create(null);
        s.ownedKeys = Object.create(null);
        s.pending = Object.create(null);
        s.wanted = Object.create(null);
        s.placeQueue = [];
        s._flush = () => s._flushPlaceQueue();
        s._onComplete = () => {
            const jobs = Object.keys(s.pending);
            for (let i = 0; i < jobs.length; i++) {
                const job = s.pending[jobs[i]];
                if (s.scene && s.scene.textures.exists('tile:' + job.t.image)) s.placeQueue.push(job);
            }
        };
        s._onError = (file) => {
            const key = file && file.key;
            Object.keys(s.pending).forEach((id) => {
                if ('tile:' + s.pending[id].t.image === key) delete s.pending[id];
            });
        };
        scene.load.on('complete', s._onComplete);
        scene.load.on('loaderror', s._onError);
        scene.events.on('preupdate', s._flush);
        return s;
    },

    shouldStream(map) {
        return !!(map && map.streamTiles);
    },

    update() {
        if (!this.scene || !this.scene.cameras) return;
        const cam = this.scene.cameras.main;
        if (!cam) return;
        const view = cam.worldView;
        const gs = this.gs;
        const pad = gs;
        const x0 = view.x - pad;
        const y0 = view.y - pad;
        const x1 = view.x + view.width + pad;
        const y1 = view.y + view.height + pad;
        const drop = gs * 2;
        const dx0 = view.x - drop;
        const dy0 = view.y - drop;
        const dx1 = view.x + view.width + drop;
        const dy1 = view.y + view.height + drop;

        const nextWanted = Object.create(null);
        const tiles = this.map.tiles || [];
        const toLoad = [];
        for (let i = 0; i < tiles.length; i++) {
            const t = tiles[i];
            const tw = (t.w || t.spanW || 1) * gs;
            const th = (t.h || t.spanH || 1) * gs;
            const tx = t.col * gs;
            const ty = t.row * gs;
            if (tx + tw < x0 || ty + th < y0 || tx > x1 || ty > y1) continue;
            const id = t.col + ',' + t.row + ':' + t.image;
            nextWanted[id] = true;
            if (this.sprites[id] || this.pending[id]) continue;
            toLoad.push({ t: t, i: i, id: id });
        }
        this.wanted = nextWanted;

        const ids = Object.keys(this.sprites);
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const rec = this.sprites[id];
            if (nextWanted[id]) continue;
            if (rec.x + rec.w >= dx0 && rec.y + rec.h >= dy0 && rec.x <= dx1 && rec.y <= dy1) continue;
            this._drop(id);
        }

        if (!toLoad.length) return;
        for (let i = 0; i < toLoad.length; i++) {
            const job = toLoad[i];
            this.pending[job.id] = job;
            const key = 'tile:' + job.t.image;
            if (this.scene.textures.exists(key)) {
                this.placeQueue.push(job);
                continue;
            }
            this.scene.load.image(key, 'assets/images/maps/' + job.t.image);
        }
        if (this.scene.load && !this.scene.load.isLoading()) {
            const scene = this.scene;
            scene.time.delayedCall(0, () => {
                if (scene.load && !scene.load.isLoading()) scene.load.start();
            });
        }
    },

    _flushPlaceQueue() {
        if (!this.placeQueue.length) return;
        const jobs = this.placeQueue;
        this.placeQueue = [];
        for (let i = 0; i < jobs.length; i++) this._place(jobs[i]);
        if (this.scene && this.scene.children && this.scene.children.queueDepthSort) {
            this.scene.children.queueDepthSort();
        }
    },

    _place(job) {
        delete this.pending[job.id];
        if (!this.wanted[job.id] || !this.scene || !this.scene.add) return;
        if (this.sprites[job.id]) return;
        const t = job.t;
        const gs = this.gs;
        const key = 'tile:' + t.image;
        if (!this.scene.textures.exists(key)) return;
        const tw = (t.w || t.spanW || 1) * gs;
        const th = (t.h || t.spanH || 1) * gs;
        const tx = t.col * gs;
        const ty = t.row * gs;
        const img = WorldTileStream.addTileImage(this.scene, tx, ty, key, tw, th);
        this.sprites[job.id] = { img: img, key: key, x: tx, y: ty, w: tw, h: th };
        this.ownedKeys[key] = (this.ownedKeys[key] || 0) + 1;
    },

    _drop(id) {
        const rec = this.sprites[id];
        if (!rec) return;
        if (rec.img && rec.img.destroy) rec.img.destroy();
        delete this.sprites[id];
        this.ownedKeys[rec.key] = (this.ownedKeys[rec.key] || 1) - 1;
        if (this.ownedKeys[rec.key] <= 0) {
            delete this.ownedKeys[rec.key];
            if (this.scene && this.scene.textures && this.scene.textures.exists(rec.key)) {
                this.scene.textures.remove(rec.key);
            }
        }
    },

    destroy() {
        if (this.scene && this.scene.load && this._onComplete) {
            this.scene.load.off('complete', this._onComplete);
            this.scene.load.off('loaderror', this._onError);
        }
        if (this.scene && this.scene.events && this._flush) {
            this.scene.events.off('preupdate', this._flush);
        }
        Object.keys(this.sprites).forEach((id) => this._drop(id));
        this.placeQueue = [];
        this.pending = Object.create(null);
        this.scene = null;
        this.map = null;
    }
};

window.WorldTileStream = WorldTileStream;
