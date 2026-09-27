/* =====================================================================
 * 全局音频系统（AudioSys.js）
 * =====================================================================
 * 作用：统一管理 BGM 与音效的加载播放。
 *   - 音乐（bgm/battle）循环播放，切换时自动停掉上一首；
 *   - 音效一次性播放，不缓存、不叠加；
 *   - 全局静音开关（M 键）。
 *
 * 用法：
 *   AudioSys.playMusic(this, 'bgm_main');     // 切到主 BGM（循环）
 *   AudioSys.playMusic(this, 'bgm_battle');   // 切到战斗 BGM
 *   AudioSys.stopMusic();
 *   AudioSys.sfx(this, 'sfx_grab');           // 播放一次性音效
 * ===================================================================== */
window.AudioSys = (function () {
    let musicKey = null;      // 当前播放中的音乐 key
    let musicSound = null;    // 当前音乐 sound 对象
    let muted = false;        // 全局静音

    const MUSIC_VOL = 0.55;   // 音乐音量
    const SFX_VOL = 0.9;      // 音效音量

    return {
        /** 播放/切换循环音乐（自动停掉上一首） */
        playMusic(scene, key) {
            if (!scene || !scene.sound || !key) return;
            if (musicSound && musicKey === key && musicSound.isPlaying) return;
            this.stopMusic();
            if (!scene.cache || !scene.cache.audio || !scene.cache.audio.exists(key)) return;
            musicKey = key;
            musicSound = scene.sound.add(key, { loop: true, volume: MUSIC_VOL });
            musicSound.play();
        },

        /** 停止当前音乐 */
        stopMusic() {
            if (musicSound) {
                try { musicSound.stop(); } catch (e) {}
                musicSound.destroy();
            }
            musicSound = null;
            musicKey = null;
        },

        /** 播放一次性音效 */
        sfx(scene, key, volume) {
            if (!scene || !scene.sound || !key || muted) return;
            if (!scene.cache || !scene.cache.audio || !scene.cache.audio.exists(key)) return;
            scene.sound.play(key, { volume: volume != null ? volume : SFX_VOL });
        },

        /** 全局静音开关：true=静音，false=恢复 */
        setMuted(v) {
            muted = !!v;
            if (musicSound && musicSound.isPlaying) {
                if (muted) musicSound.pause();
                else musicSound.resume();
            }
        },

        isMuted() {
            return muted;
        }
    };
})();
