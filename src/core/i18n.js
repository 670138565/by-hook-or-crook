/* =====================================================================
 * 多语言（i18n.js）
 * =====================================================================
 * 作用：给全游戏提供语言切换。文本一律走 t(key, fallback)：
 *   1. 按当前语言查语言表（en / es / pt / zh）
 *   2. 缺键自动回退中文（zh 是母本）
 *   3. 再缺回退传入的 fallback（默认是代码里的原文）
 *
 * 语言表在 src/locales/zh.js / en.js / es.js / pt.js，
 * 每个文件往 window.LOCALES 里注册一份 { key: 文本 }。
 *
 * 用法：
 *   const s = I18N.t('title.start', '开始游戏');
 *   I18N.t('dlg.x.y', '默认文本', { n: 3 });   // {n} 会被替换
 *   I18N.lang();      // 当前语言
 *   I18N.setLang('en');  // 切换并保存，广播 'i18n:changed'
 * ===================================================================== */
window.LOCALES = window.LOCALES || {};

window.I18N = {
    DEFAULT_LANG: 'zh',
    SUPPORTED: ['zh', 'en', 'es', 'pt'],
    LANG_KEY: 'dyyd_lang',

    lang() {
        const saved = (function () {
            try { return localStorage.getItem(I18N.LANG_KEY); } catch (e) { return null; }
        })();
        if (saved && I18N.SUPPORTED.indexOf(saved) >= 0) return saved;
        return I18N.DEFAULT_LANG;
    },

    setLang(lang) {
        if (I18N.SUPPORTED.indexOf(lang) < 0) lang = I18N.DEFAULT_LANG;
        try { localStorage.setItem(I18N.LANG_KEY, lang); } catch (e) { /* 隐私模式忽略 */ }
        if (window.EventBus) EventBus.emit('i18n:changed', lang);
        return lang;
    },

    isZh() { return I18N.lang() === 'zh'; },

    /**
     * 取当前语言的文本。
     * key 支持层级 'a.b.c'；也可传数组做多级回退。
     * 找不到回退顺序：当前语言 → 中文 → fallback（原文）→ key。
     */
    t(key, fallback, vars) {
        if (key == null) return fallback != null ? fallback : '';
        const lang = I18N.lang();
        let s = I18N._pick(LOCALES[lang], key);
        if (s == null && lang !== I18N.DEFAULT_LANG) s = I18N._pick(LOCALES[I18N.DEFAULT_LANG], key);
        if (s == null) s = fallback;
        if (s == null) s = key;
        s = String(s);
        if (vars) {
            Object.keys(vars).forEach(k => {
                s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
            });
        }
        return s;
    },

    _pick(table, key) {
        if (!table) return null;
        if (typeof table[key] === 'string') return table[key];
        const parts = String(key).split('.');
        let o = table;
        for (let i = 0; i < parts.length; i++) {
            if (o == null) return null;
            o = o[parts[i]];
        }
        return (o == null || typeof o === 'object') ? null : o;
    }
};

/** 简写：全局 window.t 也可用 */
window.t = function (key, fallback, vars) {
    return I18N.t(key, fallback, vars);
};
