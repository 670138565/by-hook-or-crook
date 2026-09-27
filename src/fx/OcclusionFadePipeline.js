/* 亨利周围一圈：挡住他的图在圈里按 OCCLUSION_FADE_ALPHA 变淡。
 * 用屏幕像素 gl_FragCoord 画圆（PostFX 的 UV 会对不齐，圈会错）。
 * 每张图在 onBind 里自己绑贴图，避免后加载的地砖把树/房子画成草地。
 */
class OcclusionFadePipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
    constructor(game) {
        super({
            game: game,
            name: 'OcclusionFade',
            forceZero: true,
            fragShader: [
                'precision mediump float;',
                'uniform sampler2D uMainSampler;',
                'uniform vec2 uPlayer;',
                'uniform float uRadius;',
                'uniform float uAlpha;',
                'varying vec2 outTexCoord;',
                'varying vec4 outTint;',
                'void main() {',
                '    vec4 color = texture2D(uMainSampler, outTexCoord);',
                '    color *= vec4(outTint.rgb * outTint.a, outTint.a);',
                '    float d = distance(gl_FragCoord.xy, uPlayer);',
                '    float t = smoothstep(uRadius * 0.55, uRadius, d);',
                '    float a = mix(uAlpha, 1.0, t);',
                '    gl_FragColor = vec4(color.rgb, color.a * a);',
                '}'
            ].join('\n')
        });
    }

    onBind(gameObject) {
        Phaser.Renderer.WebGL.Pipelines.SinglePipeline.prototype.onBind.call(this, gameObject);
        this.set2f('uPlayer', OcclusionFadePipeline.px, OcclusionFadePipeline.py);
        this.set1f('uRadius', OcclusionFadePipeline.radius);
        const fade = (gameObject && gameObject._occFade != null)
            ? gameObject._occFade
            : OcclusionFadePipeline.alpha;
        this.set1f('uAlpha', fade);
        const src = gameObject && gameObject.frame && gameObject.frame.source;
        if (src && src.glTexture) this.bindTexture(src.glTexture, 0);
    }
}

OcclusionFadePipeline.px = 0;
OcclusionFadePipeline.py = 0;
OcclusionFadePipeline.radius = 100;
OcclusionFadePipeline.alpha = 0.5;

OcclusionFadePipeline.ensure = function (game) {
    const renderer = game && game.renderer;
    if (!renderer || !renderer.pipelines) return null;
    const existing = renderer.pipelines.get('OcclusionFade');
    if (existing) return existing;
    try {
        const pipe = new OcclusionFadePipeline(game);
        renderer.pipelines.add('OcclusionFade', pipe);
        return pipe;
    } catch (e) {
        console.warn('OcclusionFade 管线不可用，改用整件变淡', e);
        return null;
    }
};
