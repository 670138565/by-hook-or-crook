/* =====================================================================
 * 新手交互式教程（TutSys.js）
 * 玩法：顶部教学气泡按步推进，玩家完成当前动作自动进入下一步。
 * 气泡样式沿用 UiTheme（深木底 + 暖金描边），按键用金色胶囊高亮。
 * 教程只在出生地图启动，完成后 GameState.markGuideDone()。
 * 外部事件通知：TutSys.notify('openedBackpack' / 'chestOpened' / 'itemToBackpack')
 * ===================================================================== */
window.TutSys = (function () {
    const steps = (window.TUTORIAL && window.TUTORIAL.steps) || [];
    let scene = null;
    let alive = false;
    let idx = -1;
    let bubble = null;
    let els = [];
    let movedAcc = 0;
    let lastX = 0;
    let lastY = 0;
    let flags = {};
    let delayAcc = 0;

    const api = {
        attach: attach,
        detach: detach,
        update: update,
        notify: notify,
        isTeaching: function () { return alive && idx >= 0 && idx < steps.length; },
        inStep: function (id) { return alive && steps[idx] && steps[idx].id === id; },
        stepId: function () { return alive && steps[idx] ? steps[idx].id : ''; },
        onDone: null
    };

    function attach(s, opts) {
        if (alive) detach();
        if (!s || !s.player) return null;
        const force = !!(opts && opts.force);
        if (!force && window.GameState && GameState.isGuideDone()) return null;
        if (!steps.length) return null;
        // 只在出生地图启动引导
        if (window.WorldManager && s.currentMapKey !== WorldManager.getStartMap()) return null;
        scene = s;
        alive = true;
        idx = 0;
        movedAcc = 0;
        delayAcc = 0;
        flags = {};
        lastX = s.player.x;
        lastY = s.player.y;
        buildBubble();
        showStep(0);
        return api;
    }

    function detach() {
        alive = false;
        scene = null;
        els = [];
        if (bubble) { bubble.destroy(); bubble = null; }
    }

    function finish() {
        if (window.GameState) GameState.markGuideDone();
        if (api.onDone) { try { api.onDone(); } catch (e) { /* ignore */ } }
        if (!alive || !scene || !bubble) { detach(); return; }
        scene.tweens.add({
            targets: bubble,
            alpha: 0,
            duration: 500,
            onComplete: function () { detach(); }
        });
    }

    function buildBubble() {
        bubble = scene.add.container(0, 0).setDepth(60000).setScrollFactor(0);
        bubble.setAlpha(0);
        pinBubble();
        scene.tweens.add({ targets: bubble, alpha: 1, duration: 260, ease: 'Sine.easeOut' });
    }

    /** 气泡固定屏幕上方居中，不被镜头缩放 */
    function pinBubble() {
        if (!scene || !bubble) return;
        const cam = scene.cameras.main;
        if (!cam) return;
        const zoom = cam.zoom || 1;
        const top = 86;
        if (scene.pinToScreen) {
            scene.pinToScreen(bubble, cam.width / 2, top, zoom);
        } else {
            bubble.setScale(1 / zoom);
            bubble.setPosition(
                cam.width / 2,
                cam.height / 2 + (top - cam.height / 2) / zoom
            );
        }
    }

    function showStep(i) {
        if (!alive || !scene || !bubble) return;
        const st = steps[i];
        if (!st) { finish(); return; }
        const ui = window.UiTheme || {};
        const font = ui.font || '"Microsoft YaHei","微软雅黑",sans-serif';

        // 清掉上一句
        els.forEach(function (e) { if (e && e.destroy) e.destroy(); });
        els = [];
        bubble.removeAll(true);

        const bg = scene.add.graphics();
        els.push(bg);

        // 按 {KEY} 拆段：按键 → 金色胶囊，普通 → 米色文字
        const parts = String(st.text || '').split(/(\{[^}]+\})/g).filter(Boolean);
        let x = 0;
        const yLine = -10;
        parts.forEach(function (p) {
            const isKey = /^\{.+\}$/.test(p);
            if (isKey) {
                const label = p.slice(1, -1);
                const t = scene.add.text(x, yLine, label, {
                    fontFamily: font, fontSize: '15px', fill: ui.gold || '#e0c078', fontStyle: 'bold'
                }).setOrigin(0, 0.5);
                const cap = scene.add.graphics();
                cap.fillStyle(0x2a1f12, 0.95);
                cap.fillRoundedRect(x - 9, yLine - 13, t.width + 18, 26, 7);
                cap.lineStyle(1.5, 0xc4a574, 0.85);
                cap.strokeRoundedRect(x - 9, yLine - 13, t.width + 18, 26, 7);
                els.push(cap, t);
                x += t.width + 18;
            } else {
                const t = scene.add.text(x, yLine, p, {
                    fontFamily: font, fontSize: '16px', fill: ui.ink || '#e8dcc8'
                }).setOrigin(0, 0.5);
                els.push(t);
                x += t.width + 6;
            }
        });
        const totalW = x;

        let detailText = null;
        if (st.detail) {
            detailText = scene.add.text(0, 14, st.detail, {
                fontFamily: font, fontSize: '13px', fill: ui.muted || '#9a8f7e'
            }).setOrigin(0.5, 0.5);
            els.push(detailText);
        }

        // 背景圆角面板（深木底 + 暖金描边）
        const bw = Math.max(totalW, detailText ? detailText.width : 0) + 52;
        bg.fillStyle(0x16120e, 0.92);
        bg.fillRoundedRect(-bw / 2, -36, bw, 72, 10);
        bg.lineStyle(1.5, 0xc4a574, 0.6);
        bg.strokeRoundedRect(-bw / 2, -36, bw, 72, 10);
        bg.lineStyle(2, 0xb8955a, 0.45);
        bg.lineBetween(-bw / 2 + 14, -28, -bw / 2 + Math.min(bw - 28, 90), -28);

        bubble.add(bg);
        // 普通文字段整体居中
        els.forEach(function (e) {
            if (e === bg || e === detailText) return;
            e.x -= totalW / 2;
        });
        els.forEach(function (e) { bubble.add(e); });

        // 轻微弹跳进场
        bubble.setScale((1 / (scene.cameras.main.zoom || 1)) * 0.97);
        scene.tweens.add({
            targets: bubble, scale: 1 / (scene.cameras.main.zoom || 1),
            duration: 200, ease: 'Sine.easeOut'
        });
        pinBubble();
    }

    function update(delta) {
        if (!alive || !scene || !scene.player) return;
        const st = steps[idx];
        if (!st) return;
        let advanced = false;
        const adv = st.advance || {};
        if (adv.type === 'playerMoved') {
            const p = scene.player;
            movedAcc += Math.hypot(p.x - lastX, p.y - lastY);
            lastX = p.x;
            lastY = p.y;
            if (movedAcc >= (adv.distance || 70)) advanced = true;
        } else if (adv.type === 'flag') {
            if (window.GameState && GameState.get(adv.key, false) === adv.value) advanced = true;
        } else if (adv.type === 'notify') {
            if (flags[adv.event]) advanced = true;
        } else if (adv.type === 'delay') {
            delayAcc += delta;
            if (delayAcc >= (adv.ms || 3000)) advanced = true;
        } else {
            advanced = true;
        }
        if (advanced) {
            idx++;
            if (idx >= steps.length) { finish(); return; }
            showStep(idx);
        }
    }

    function notify(eventName) {
        if (eventName) flags[eventName] = true;
    }

    return api;
})();
