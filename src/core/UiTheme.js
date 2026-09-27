/* =====================================================================
 * 游戏 UI 主题（UiTheme.js）
 * 深木底 + 暖金描边，偏中世纪账本感，给 HUD / 对话 / 引导共用。
 * ===================================================================== */
window.UiTheme = {
    font: '"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif',
    fontTitle: '"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif',

    ink: '#e8dcc8',
    muted: '#9a8f7e',
    gold: '#e0c078',
    goldDim: '#a89060',
    sage: '#b7c9a3',
    wine: '#d4a5a5',
    danger: '#e89b8c',
    panelFill: 0x16120e,
    panelAlpha: 0.86,
    panelStroke: 0xc4a574,
    panelStrokeAlpha: 0.55,
    accent: 0xb8955a,

    textStyle(extra) {
        const base = {
            fontFamily: this.font,
            fontSize: '15px',
            fill: this.ink,
            padding: { x: 2, y: 2 }
        };
        if (!extra) return base;
        Object.keys(extra).forEach(k => { base[k] = extra[k]; });
        return base;
    },

    /** 在 graphics 上画圆角面板（本地坐标，左上为 0,0） */
    paintPanel(gfx, w, h, pad) {
        if (!gfx) return;
        const p = pad == null ? 10 : pad;
        const rw = Math.max(8, w + p * 2);
        const rh = Math.max(8, h + p * 2);
        gfx.clear();
        gfx.fillStyle(this.panelFill, this.panelAlpha);
        gfx.fillRoundedRect(-p, -p, rw, rh, 8);
        gfx.lineStyle(1.5, this.panelStroke, this.panelStrokeAlpha);
        gfx.strokeRoundedRect(-p, -p, rw, rh, 8);
        gfx.lineStyle(2, this.accent, 0.35);
        gfx.lineBetween(-p + 10, -p + 3, -p + Math.min(rw - 10, 72), -p + 3);
    }
};
