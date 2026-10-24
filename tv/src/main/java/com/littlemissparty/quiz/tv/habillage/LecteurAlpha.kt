package com.littlemissparty.quiz.tv.habillage

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import android.view.TextureView
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * Les clips du robot sont des vidéos MP4 (H.264, décodées par la puce vidéo de la box) dont la moitié haute est
 * l'image et la moitié basse sa transparence, en gris. Six fois plus légères qu'une animation WebP de même qualité :
 * c'est ce qui permet d'avoir une vingtaine d'animations dans l'appli. Ce petit shader recompose l'image transparente.
 */
internal const val SHADER_SOMMETS = """
attribute vec2 aPos;
varying vec2 v;
void main() {
    v = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
"""

/**
 * Image : couleur en haut (rendu sur noir, donc prémultipliée), bande noire de 16 lignes pour 720, transparence en bas,
 * dans ces proportions quelle que soit la taille du clip (848 × 2144 pour les petits, 1888 × 2148 en plein écran).
 * La bande noire évite que la compression mélange les deux moitiés. La transparence est la silhouette nette du robot ;
 * la lueur de ses néons reste dans la couleur seule et s'ajoute au décor comme de la lumière (cedric, 23/10 : plus de
 * voile pâle autour du robot). Hors de la silhouette, le léger bruit du noir compressé est effacé.
 */
internal const val SHADER_PIXELS = """
#extension GL_OES_EGL_image_external : require
precision mediump float;
uniform samplerExternalOES uTex;
uniform mat4 uM;
varying vec2 v;
void main() {
    vec3 c = texture2D(uTex, (uM * vec4(v.x, 0.50549 + 0.49451 * v.y, 0.0, 1.0)).xy).rgb;
    float a = texture2D(uTex, (uM * vec4(v.x, 0.49451 * v.y, 0.0, 1.0)).xy).r;
    a = clamp((a - 0.04) / 0.92, 0.0, 1.0);
    c = mix(max(c - vec3(0.03), vec3(0.0)) / 0.97, c, a);
    gl_FragColor = vec4(c, a);
}
"""

/** Compile le programme des clips dans le contexte OpenGL courant ; 0 si la box ne sait pas le faire. */
internal fun programmeAlpha(): Int {
    fun shader(type: Int, source: String): Int {
        val s = GLES20.glCreateShader(type)
        GLES20.glShaderSource(s, source)
        GLES20.glCompileShader(s)
        val ok = IntArray(1)
        GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0)
        if (ok[0] == 0) {
            Log.w("Habillage", "Shader du robot refusé : ${GLES20.glGetShaderInfoLog(s)}")
            GLES20.glDeleteShader(s)
            return 0
        }
        return s
    }
    val vs = shader(GLES20.GL_VERTEX_SHADER, SHADER_SOMMETS).takeIf { it != 0 } ?: return 0
    val fs = shader(GLES20.GL_FRAGMENT_SHADER, SHADER_PIXELS).takeIf { it != 0 } ?: return 0
    val p = GLES20.glCreateProgram()
    GLES20.glAttachShader(p, vs)
    GLES20.glAttachShader(p, fs)
    GLES20.glLinkProgram(p)
    val ok = IntArray(1)
    GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0)
    if (ok[0] == 0) {
        Log.w("Habillage", "Programme du robot refusé : ${GLES20.glGetProgramInfoLog(p)}")
        return 0
    }
    return p
}

/**
 * Joue un clip du robot ([resId], res/raw/gs_robot_*.mp4) dans un TextureView transparent, posé sur l'écran du jeu
 * comme une image (Compose le déplace avec un simple calque). Le décodage et le dessin se font sur un fil à part.
 * [surDebut] : la première image est à l'écran ; [surEchec] : clip illisible (fichier, décodeur, OpenGL), il n'y a
 * simplement pas de robot. Rien ici ne touche à la partie. [liberer] rend tout (lecteur, OpenGL, fil).
 * [boucleDepuisMs] ≥ 0 : à la fin, le clip repart de là, sans fin (podium, écran de fin : une entrée, puis une danse
 * qui boucle). Le clip a une image clé à cet endroit : le retour est immédiat.
 * [boucle] : le clip tourne en boucle sans couture (disque du blind test) ; [vitesse] le ralentit et le fige.
 */
internal class LecteurAlpha(
    context: Context,
    private val resId: Int,
    private val surDebut: () -> Unit,
    private val surEchec: () -> Unit,
    private val boucleDepuisMs: Int = -1,
    private val boucle: Boolean = false,
) : TextureView(context), TextureView.SurfaceTextureListener {
    private val fil = HandlerThread("robot-game-show").apply { start() }
    private val h = Handler(fil.looper)
    private var egl: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var ctx: EGLContext = EGL14.EGL_NO_CONTEXT
    private var fenetre: EGLSurface = EGL14.EGL_NO_SURFACE
    private var ecran: SurfaceTexture? = null
    private var video: SurfaceTexture? = null
    private var surfaceVideo: Surface? = null
    private var lecteur: MediaPlayer? = null
    private var programme = 0
    private var texture = 0
    private val matrice = FloatArray(16)
    private val quad: FloatBuffer = ByteBuffer.allocateDirect(8 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
        .apply { put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)); position(0) }

    @Volatile private var fini = false
    @Volatile private var cible = 1f
    private var prepare = false
    private var image = false

    init {
        isOpaque = false
        surfaceTextureListener = this
    }

    override fun onSurfaceTextureAvailable(st: SurfaceTexture, largeur: Int, hauteur: Int) {
        h.post { demarrer(st, largeur, hauteur) }
    }

    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, largeur: Int, hauteur: Int) {
        h.post { if (!fini && fenetre != EGL14.EGL_NO_SURFACE) GLES20.glViewport(0, 0, largeur, hauteur) }
    }

    /** La surface reste à nous : elle est rendue sur le fil OpenGL, après la fenêtre EGL qui dessine dedans. */
    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        ecran = st
        liberer()
        return false
    }

    override fun onSurfaceTextureUpdated(st: SurfaceTexture) = Unit

    private fun echec(e: Throwable) {
        Log.w("Habillage", "Robot ignoré : ${e.message}")
        post { surEchec() }
    }

    private fun demarrer(st: SurfaceTexture, largeur: Int, hauteur: Int) {
        if (fini) {
            st.release()
            return
        }
        ecran = st
        try {
            egl = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            val version = IntArray(2)
            check(EGL14.eglInitialize(egl, version, 0, version, 1)) { "EGL indisponible" }
            val attributs = intArrayOf(
                EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_NONE,
            )
            val configs = arrayOfNulls<EGLConfig>(1)
            val n = IntArray(1)
            check(EGL14.eglChooseConfig(egl, attributs, 0, configs, 0, 1, n, 0) && n[0] > 0) { "pas de configuration EGL" }
            ctx = EGL14.eglCreateContext(egl, configs[0], EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
            check(ctx != EGL14.EGL_NO_CONTEXT) { "pas de contexte EGL" }
            fenetre = EGL14.eglCreateWindowSurface(egl, configs[0], st, intArrayOf(EGL14.EGL_NONE), 0)
            check(fenetre != EGL14.EGL_NO_SURFACE && EGL14.eglMakeCurrent(egl, fenetre, fenetre, ctx)) { "pas de surface EGL" }
            GLES20.glViewport(0, 0, largeur, hauteur)
            programme = programmeAlpha()
            check(programme != 0) { "shader refusé" }
            val t = IntArray(1)
            GLES20.glGenTextures(1, t, 0)
            texture = t[0]
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texture)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            // Transparent tant que la vidéo n'a rien donné.
            GLES20.glClearColor(0f, 0f, 0f, 0f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            EGL14.eglSwapBuffers(egl, fenetre)

            val v = SurfaceTexture(texture).also { video = it }
            v.setOnFrameAvailableListener({ dessiner() }, h)
            val s = Surface(v).also { surfaceVideo = it }
            lecteur = MediaPlayer().apply {
                context.resources.openRawResourceFd(resId).use { setDataSource(it.fileDescriptor, it.startOffset, it.length) }
                setSurface(s)
                setOnInfoListener { _, quoi, _ ->
                    if (quoi == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) {
                        image = true
                        if (cible != 1f) appliquerVitesse()
                        post { surDebut() }
                    }
                    false
                }
                setOnErrorListener { _, quoi, extra ->
                    echec(IllegalStateException("lecteur $quoi/$extra"))
                    true
                }
                if (boucleDepuisMs >= 0) setOnCompletionListener { mp ->
                    if (!fini) {
                        mp.seekTo(boucleDepuisMs)
                        mp.start()
                    }
                }
                if (boucle) isLooping = true
                setOnPreparedListener {
                    if (!fini) {
                        prepare = true
                        it.start()
                    }
                }
                prepareAsync()
            }
        } catch (e: Throwable) {
            echec(e)
        }
    }

    private fun dessiner() {
        val v = video ?: return
        if (fini || fenetre == EGL14.EGL_NO_SURFACE) return
        try {
            v.updateTexImage()
            v.getTransformMatrix(matrice)
            GLES20.glClearColor(0f, 0f, 0f, 0f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            GLES20.glUseProgram(programme)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texture)
            GLES20.glUniform1i(GLES20.glGetUniformLocation(programme, "uTex"), 0)
            GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(programme, "uM"), 1, false, matrice, 0)
            val pos = GLES20.glGetAttribLocation(programme, "aPos")
            GLES20.glEnableVertexAttribArray(pos)
            GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, quad)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            EGL14.eglSwapBuffers(egl, fenetre)
        } catch (e: Throwable) {
            Log.w("Habillage", "Image du robot ignorée : ${e.message}")
        }
    }

    /**
     * Vitesse de lecture : 1 normale, entre les deux ralentie, 0 figée sur l'image en cours. Une box qui ne sait pas
     * ralentir passe directement de l'un à l'autre. Avant la première image, la vitesse attend qu'elle soit là.
     */
    fun vitesse(v: Float) {
        cible = v.coerceIn(0f, 1f)
        h.post { appliquerVitesse() }
    }

    private fun appliquerVitesse() {
        val mp = lecteur ?: return
        if (fini || !prepare || !image) return
        val v = cible
        try {
            if (v <= 0f) {
                if (mp.isPlaying) mp.pause()
            } else {
                mp.playbackParams = mp.playbackParams.setSpeed(v)
                if (!mp.isPlaying) mp.start()
            }
        } catch (e: Throwable) {
            Log.w("Habillage", "Vitesse du clip ignorée : ${e.message}")
            try {
                if (v < 0.5f && mp.isPlaying) mp.pause() else if (v >= 0.5f && !mp.isPlaying) mp.start()
            } catch (_: Throwable) {}
        }
    }

    /** Arrête le clip et rend tout ; sans effet la deuxième fois. */
    fun liberer() {
        if (fini) return
        fini = true
        h.post {
            try { lecteur?.release() } catch (_: Throwable) {}
            lecteur = null
            surfaceVideo?.release()
            surfaceVideo = null
            video?.release()
            video = null
            if (egl != EGL14.EGL_NO_DISPLAY) {
                EGL14.eglMakeCurrent(egl, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
                if (fenetre != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(egl, fenetre)
                if (ctx != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(egl, ctx)
                EGL14.eglReleaseThread()
            }
            fenetre = EGL14.EGL_NO_SURFACE
            ctx = EGL14.EGL_NO_CONTEXT
            ecran?.release()
            ecran = null
            fil.quitSafely()
        }
    }
}
